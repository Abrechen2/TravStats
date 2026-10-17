import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import * as engine from "../../services/tripSuggestions/engine";

/**
 * The account's `tripSuggestions.enabled` switch (forgejo#306): off, the engine
 * does not run, the list and the badge answer empty, and an answer is refused.
 * The decisions already made survive the switch-off and apply again on the way
 * back.
 */

const FLORENCE = { lat: 43.7765, lon: 11.2479 };
const ROMA = { lat: 41.901, lon: 12.5006 };

describe("trip suggestions switch (forgejo#306)", () => {
  let userId: string;
  let cookie: string;

  const setSwitch = (enabled: boolean) =>
    prisma.userSettings.update({ where: { userId }, data: { tripSuggestionsEnabled: enabled } });

  /** Two consecutive stays away from home: one new-trip proposal. */
  const seedItaly = async () => {
    for (const [name, at, from, to] of [
      ["Florenz", FLORENCE, "2025-05-03", "2025-05-06"],
      ["Rom", ROMA, "2025-05-06", "2025-05-09"],
    ] as const) {
      const lodging = await prisma.lodging.create({ data: { userId, name, city: name, ...at } });
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkIn: new Date(`${from}T00:00:00Z`),
          checkOut: new Date(`${to}T00:00:00Z`),
        },
      });
    }
  };

  const get = (path: string) =>
    request(app).get(`/api/v1/trip-suggestions${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `ts-switch-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging"],
        data: { homeAirportHistory: [{ iata: "MUC", fromDate: "2000-01-01", toDate: null }] },
      },
    });
  });

  beforeEach(async () => {
    await prisma.tripSuggestionDecision.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await setSwitch(true);
    await seedItaly();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("is on by default and lists and counts the proposal", async () => {
    expect((await get("/count")).body.data.count).toBe(1);
    const list = await get("");
    expect(list.body.data.suggestions).toHaveLength(1);
    expect(list.body.data.disabled).toBe(false);
  });

  it("off: the engine does not run, the list is empty and says why, the badge is 0", async () => {
    await setSwitch(false);
    const spy = jest.spyOn(engine, "computeTripSuggestions");

    const list = await get("");
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual({
      suggestions: [],
      total: 0,
      home: null,
      truncated: false,
      disabled: true,
    });
    const count = await get("/count");
    expect(count.body.data.count).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("off: accept and dismiss are refused without computing", async () => {
    const [proposal] = (await get("")).body.data.suggestions as { id: string }[];
    await setSwitch(false);
    const spy = jest.spyOn(engine, "computeTripSuggestions");
    for (const action of ["accept", "dismiss"]) {
      const res = await request(app)
        .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/${action}`)
        .set("Cookie", cookie)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TRIP_SUGGESTIONS_DISABLED");
    }
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("switching off keeps a dismissal; back on, the dismissed proposal stays gone", async () => {
    const [proposal] = (await get("")).body.data.suggestions as { id: string }[];
    await request(app)
      .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/dismiss`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);

    await setSwitch(false);
    expect(await prisma.tripSuggestionDecision.count({ where: { userId } })).toBe(1);
    await setSwitch(true);

    expect((await get("/count")).body.data.count).toBe(0);
    expect((await get("")).body.data.suggestions).toEqual([]);
  });
});

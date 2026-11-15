import request from "supertest";
import { jest } from "@jest/globals";
import axios from "axios";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { flightLivePositionLimiter } from "../../middleware/livePositionLimiter";
import {
  __resetAdsbForTests,
  __setAdsbMinIntervalForTests,
} from "../../services/flightLookup/adsbV2";

/**
 * GET /flights/:id/live-position (forgejo#408 phase 2). axios is spied: no network.
 * "Unavailable" is a 200 with a stable reason; each is asserted.
 */
const HOUR = 3_600_000;
const aircraft = (over: Record<string, unknown> = {}) => ({
  hex: "3c6444",
  flight: "DLH100  ",
  r: "D-AIXA",
  t: "A359",
  lat: 49.5,
  lon: 9.1,
  alt_baro: 34_000,
  gs: 440,
  track: 123,
  seen: 2,
  ...over,
});

describe("GET /flights/:id/live-position", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let getSpy: jest.SpiedFunction<typeof axios.get>;
  const urls: string[] = [];
  let respond: (url: string) => unknown;

  const flightAt = async (departure: number, arrival: number, over: Record<string, unknown> = {}) =>
    (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50,
          depLon: 8,
          arrLat: 48.3,
          arrLon: 11.7,
          flightNumber: "LH100",
          aircraftModeS: "3C6444",
          aircraftRegistration: "D-AIXA",
          departureTime: new Date(departure),
          arrivalTime: new Date(arrival),
          status: "scheduled",
          ...over,
        },
      })
    ).id;
  const live = () => flightAt(Date.now() - HOUR, Date.now() + HOUR);
  const get = (id: string, c = cookie) =>
    request(app).get(`/api/v1/flights/${id}/live-position`).set("Cookie", c);
  const setLol = (enabled: boolean) =>
    prisma.adminSettings.updateMany({ data: { adsbLolEnabled: enabled } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["livepos", "liveposb"] } } });
    userId = (
      await prisma.user.create({
        data: { username: "livepos", passwordHash: await hashPassword("password123") },
      })
    ).id;
    const other = await prisma.user.create({
      data: { username: "liveposb", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(other.id)}`;
    if (!(await prisma.adminSettings.findFirst())) await prisma.adminSettings.create({ data: {} });
  });

  beforeEach(async () => {
    await flightLivePositionLimiter.resetKey(`user:${userId}`);
    await prisma.flight.deleteMany({ where: { userId } });
    await setLol(true);
    __resetAdsbForTests();
    __setAdsbMinIntervalForTests(0);
    urls.length = 0;
    respond = () => ({ status: 200, data: { ac: [aircraft()], now: 1 } });
    getSpy = jest.spyOn(axios, "get").mockImplementation((async (url: string) => {
      urls.push(url);
      const out = respond(url);
      if (out instanceof Error) throw out;
      return out;
    }) as never);
  });

  afterEach(() => getSpy.mockRestore());

  afterAll(async () => {
    await setLol(false);
    await prisma.user.deleteMany({ where: { username: { in: ["livepos", "liveposb"] } } });
    await prisma.$disconnect();
  });

  it("returns the position, asked by hex first", async () => {
    const res = await get(await live());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      source: "adsblol",
      position: {
        lat: 49.5,
        lon: 9.1,
        altBaro: 34_000,
        groundSpeed: 440,
        track: 123,
        onGround: false,
      },
      icao24: "3C6444",
      registration: "D-AIXA",
    });
    expect(Date.parse(res.body.fetchedAt)).not.toBeNaN();
    expect(urls[0]).toBe("https://api.adsb.lol/v2/hex/3c6444");
  });

  it("falls back to registration, then callsign, when the hex is unknown", async () => {
    respond = (url) =>
      url.includes("/callsign/")
        ? { status: 200, data: { ac: [aircraft()] } }
        : { status: 200, data: { ac: [] } };
    const res = await get(await live());
    expect(res.body.status).toBe("ok");
    expect(urls.map((u) => u.split("/v2/")[1])).toEqual([
      "hex/3c6444",
      "reg/D-AIXA",
      "callsign/DLH100",
    ]);
  });

  it("answers 404 for another user's flight", async () => {
    expect((await get(await live(), otherCookie)).status).toBe(404);
    expect(urls).toHaveLength(0);
  });

  it.each([
    [
      "a flight days ago",
      () => flightAt(Date.now() - 48 * HOUR, Date.now() - 46 * HOUR),
      "not_live_window",
    ],
    [
      "a flight tomorrow",
      () => flightAt(Date.now() + 24 * HOUR, Date.now() + 26 * HOUR),
      "not_live_window",
    ],
    [
      "a cancelled flight",
      () => flightAt(Date.now() - HOUR, Date.now() + HOUR, { status: "cancelled" }),
      "not_live_window",
    ],
    [
      "a flight without schedule",
      () =>
        flightAt(0, 0).then(async (id) => {
          await prisma.flight.update({
            where: { id },
            data: { departureTime: null, arrivalTime: null },
          });
          return id;
        }),
      "no_schedule",
    ],
  ])("says %s is unavailable without asking anyone", async (_n, make, reason) => {
    const res = await get(await make());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "unavailable", reason });
    expect(urls).toHaveLength(0);
  });

  it("says no_provider when no ADS-B provider is enabled", async () => {
    await setLol(false);
    const res = await get(await live());
    expect(res.body).toEqual({ status: "unavailable", reason: "no_provider" });
    expect(urls).toHaveLength(0);
  });

  it("says no_identifier for a flight with no hex, registration or known airline", async () => {
    const id = await flightAt(Date.now() - HOUR, Date.now() + HOUR, {
      aircraftModeS: null,
      aircraftRegistration: null,
      flightNumber: null,
    });
    expect((await get(id)).body).toEqual({ status: "unavailable", reason: "no_identifier" });
  });

  it("says no_hit when nobody has the aircraft, and no_position when it has no fix", async () => {
    respond = () => ({ status: 200, data: { ac: [] } });
    expect((await get(await live())).body.reason).toBe("no_hit");
    __resetAdsbForTests();
    __setAdsbMinIntervalForTests(0);
    respond = () => ({ status: 200, data: { ac: [aircraft({ lat: undefined, lon: undefined })] } });
    expect((await get(await live())).body.reason).toBe("no_position");
  });

  it.each([
    ["401", Object.assign(new Error("x"), { response: { status: 401 } }), "auth"],
    ["429", Object.assign(new Error("x"), { response: { status: 429 } }), "quota"],
    ["a timeout", Object.assign(new Error("x"), { code: "ECONNABORTED" }), "timeout"],
    ["a 500", Object.assign(new Error("x"), { response: { status: 500 } }), "provider_error"],
  ])("names the provider failure for %s instead of 'no hit'", async (_n, error, outcome) => {
    respond = () => error;
    const res = await get(await live());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "unavailable",
      reason: "provider_error",
      failures: [{ provider: "adsblol", outcome }],
    });
  });

  it("reports an aircraft on the ground as such, without an altitude", async () => {
    respond = () => ({ status: 200, data: { ac: [aircraft({ alt_baro: "ground", gs: 12 })] } });
    const res = await get(await live());
    expect(res.body.position).toMatchObject({ onGround: true, altBaro: null, groundSpeed: 12 });
  });

  it("requires a login", async () => {
    expect((await request(app).get("/api/v1/flights/x/live-position")).status).toBe(401);
  });
});

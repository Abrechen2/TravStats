import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { utcMidnight } from "../../services/countryDays/store";
import { MONTHS_BIT, markTravTrackDaysDirty } from "../../services/travtrack/dirtyDays";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/months?year=YYYY` and the city-lookup switch (TravTrack plan
 * L3, review focus 27): the account's own months, a month without data absent,
 * cities null unless the lookup is on, the months still owed named. Tier `on`.
 */

const PREFIX = "travtrack-months-route-";

describe("TravTrack — monthly values", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const months = (query: Record<string, string>, as = cookie) =>
    request(app).get("/api/v1/travtrack/months").query(query).set("Cookie", as);
  const seed = (owner: string, month: string, extra: object = {}) =>
    prisma.travTrackMonthValue.create({
      data: {
        userId: owner,
        month: utcMidnight(month),
        kmGround: 123.456,
        countries: ["DE", "KR"],
        daysWithData: 12,
        daysPaused: 1,
        algorithm: 1,
        ...extra,
      },
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    const where = { userId: { in: [userId, otherId] } };
    await prisma.travTrackMonthValue.deleteMany({ where });
    await prisma.travTrackDirtyDay.deleteMany({ where });
    await prisma.userSettings.deleteMany({ where });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("answers the year's months; a month without data is absent, not zero", async () => {
    await seed(userId, "2026-03-01");
    await seed(userId, "2026-10-01", {
      cities: [{ name: "Seoul", countryCode: "KR" }],
      countries: ["KR"],
    });
    await seed(userId, "2025-12-01");

    const res = await months({ year: "2026" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      months: [
        {
          month: "2026-03",
          kmGround: 123.5,
          countries: ["DE", "KR"],
          cities: null,
          daysWithData: 12,
          daysPaused: 1,
        },
        {
          month: "2026-10",
          kmGround: 123.5,
          countries: ["KR"],
          cities: [{ name: "Seoul", countryCode: "KR" }],
          daysWithData: 12,
          daysPaused: 1,
        },
      ],
      pending: [],
    });
  });

  it("names the months a day of which is still owed", async () => {
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, ["2026-05-03"]));
    await prisma.travTrackDirtyDay.create({
      data: { userId, day: utcMidnight("2026-06-01"), version: 1, done: MONTHS_BIT },
    });
    expect((await months({ year: "2026" })).body).toEqual({ months: [], pending: ["2026-05"] });
  });

  it("another account's months are never read", async () => {
    await seed(otherId, "2026-03-01");
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, otherId, ["2026-05-03"]));
    expect((await months({ year: "2026" })).body).toEqual({ months: [], pending: [] });
  });

  it("refuses a year that is not one", async () => {
    for (const year of ["", "26", "abcd", "1800", "20261"]) {
      expect((await months({ year })).status).toBe(400);
    }
    expect((await request(app).get("/api/v1/travtrack/months").set("Cookie", cookie)).status).toBe(
      400
    );
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED", async () => {
    await seed(userId, "2026-03-01");
    await switches.set({ beta: true, config: false });
    const res = await months({ year: "2026" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    const lookup = await request(app).get("/api/v1/travtrack/city-lookup").set("Cookie", cookie);
    expect(lookup.status).toBe(403);
  });

  it("needs a signed-in account", async () => {
    const res = await request(app).get("/api/v1/travtrack/months").query({ year: "2026" });
    expect(res.status).toBe(401);
  });

  describe("the city lookup switch", () => {
    const lookup = () => request(app).get("/api/v1/travtrack/city-lookup").set("Cookie", cookie);
    const put = (body: object) =>
      request(app).put("/api/v1/travtrack/city-lookup").set("Cookie", cookie).send(body);

    it("is off by default", async () => {
      const res = await lookup();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false });
    });

    it("switched on, every month is owed again; switched off, named cities go at once", async () => {
      await seed(userId, "2026-10-01", { cities: [{ name: "Seoul", countryCode: "KR" }] });
      await prisma.travTrackDirtyDay.create({
        data: { userId, day: utcMidnight("2026-10-12"), version: 3, done: 7 },
      });

      expect((await put({ enabled: true })).body).toEqual({ enabled: true });
      expect((await lookup()).body).toEqual({ enabled: true });
      const row = await prisma.travTrackDirtyDay.findFirstOrThrow({ where: { userId } });
      // Only the months' bit is cleared; the version and the other bits stay.
      expect({ version: row.version, done: row.done }).toEqual({ version: 3n, done: 3 });

      expect((await put({ enabled: false })).body).toEqual({ enabled: false });
      const month = await prisma.travTrackMonthValue.findFirstOrThrow({ where: { userId } });
      expect(month.cities).toBeNull();
    });

    it("refuses a body that is not a switch", async () => {
      for (const body of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }]) {
        expect((await put(body)).status).toBe(400);
      }
    });
  });
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { generateToken } from "../../utils/jwt";
import { utcMidnight } from "../../services/countryDays/store";
import { MONTHS_BIT } from "../../services/travtrack/dirtyDays";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/stays` and `GET /travtrack/calendar` (TravTrack plan T5.3).
 * Stays: the one store's rows across pending / accepted / rejected, with day
 * and place, newest first, paged; pending empty while stay suggestions are
 * off; no position inside a privacy circle. Calendar: per day from the
 * monthly projection's stored values; a month still owed is `pending`, a row
 * without day values is `unavailable` — never a month of zeros.
 */

const PREFIX = "travtrack-stays-calendar-";

describe("TravTrack — stays and calendar", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const get = (path: string, query: Record<string, string> = {}) =>
    request(app).get(`/api/v1/travtrack/${path}`).query(query).set("Cookie", cookie);

  const stay = (owner: string, start: string, status: string, extra: object = {}) =>
    prisma.dawarichStay.create({
      data: {
        userId: owner,
        fingerprint: `${owner}-${start}-${status}`,
        sourceStartAt: new Date(start),
        sourceEndAt: new Date(Date.parse(start) + 3_600_000),
        sourceLat: 37.5,
        sourceLon: 127.0,
        status,
        startAt: new Date(start),
        endAt: new Date(Date.parse(start) + 3_600_000),
        lat: 37.5,
        lon: 127.0,
        zone: "Asia/Seoul",
        pointCount: 12,
        evidence: { pointDigests: ["secret"] } as unknown as Prisma.InputJsonValue,
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
    const where = { userId: { in: [userId, otherId] } };
    await wipeTravTrack([userId, otherId]);
    await prisma.dawarichStay.deleteMany({ where });
    await prisma.place.deleteMany({ where });
    await prisma.userSettings.deleteMany({ where });
    await prisma.travTrackMonthValue.deleteMany({ where });
    await prisma.travTrackDirtyDay.deleteMany({ where });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  describe("stays", () => {
    it("lists the three states, newest first, with day and place; never evidence", async () => {
      const place = await prisma.place.create({
        data: { userId, name: "Gyeongbokgung", lat: 37.58, lon: 126.98 },
      });
      // 23:30 UTC is the next morning in Seoul.
      await stay(userId, "2026-10-09T23:30:00Z", "accepted", { placeId: place.id });
      await stay(userId, "2026-10-08T10:00:00Z", "accepting");
      await stay(userId, "2026-10-07T10:00:00Z", "rejected");
      await stay(userId, "2026-10-06T10:00:00Z", "covered");
      await stay(userId, "2026-10-05T10:00:00Z", "invalidated");
      await stay(otherId, "2026-10-09T10:00:00Z", "pending");

      const res = await get("stays");

      expect(res.status).toBe(200);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.stays.map((s: { day: string; status: string }) => [s.day, s.status])).toEqual(
        [
          ["2026-10-10", "accepted"],
          ["2026-10-08", "pending"],
          ["2026-10-07", "rejected"],
        ]
      );
      expect(res.body.stays[0]).toMatchObject({
        place: { id: place.id, name: "Gyeongbokgung" },
        position: { lat: 37.5, lon: 127.0 },
        provider: "dawarich",
      });
      expect(JSON.stringify(res.body)).not.toContain("secret");
    });

    it("filters by state and pages with a cursor", async () => {
      for (let d = 1; d <= 3; d++) await stay(userId, `2026-10-0${d}T10:00:00Z`, "pending");
      await stay(userId, "2026-10-04T10:00:00Z", "accepted");

      const first = await get("stays", { status: "pending", limit: "2" });
      expect(first.body.stays.map((s: { day: string }) => s.day)).toEqual([
        "2026-10-03",
        "2026-10-02",
      ]);
      const rest = await get("stays", {
        status: "pending",
        limit: "2",
        cursor: first.body.nextCursor,
      });
      expect(rest.body.stays.map((s: { day: string }) => s.day)).toEqual(["2026-10-01"]);
      expect(rest.body.nextCursor).toBeNull();
      expect((await get("stays", { status: "pending,bogus" })).status).toBe(400);
    });

    it("no pending stays while stay suggestions are off; answered ones stay readable", async () => {
      await stay(userId, "2026-10-01T10:00:00Z", "pending");
      await stay(userId, "2026-10-02T10:00:00Z", "accepted");
      await prisma.userSettings.create({
        data: { userId, data: {}, staySuggestionsEnabled: false },
      });
      const res = await get("stays");
      expect(res.body.stays.map((s: { status: string }) => s.status)).toEqual(["accepted"]);
    });

    it("a stay inside a privacy zone keeps its row and loses its position", async () => {
      await stay(userId, "2026-10-01T10:00:00Z", "accepted");
      await prisma.travTrackPrivacyZone.create({
        data: { userId, name: "Zuhause", lat: 37.5, lon: 127.0, radiusM: 200 },
      });
      const res = await get("stays");
      expect(res.body.stays).toHaveLength(1);
      expect(res.body.stays[0].position).toBeNull();
    });
  });

  describe("calendar", () => {
    const month = (owner: string, m: string, dayValues: object | null) =>
      prisma.travTrackMonthValue.create({
        data: {
          userId: owner,
          month: utcMidnight(m),
          kmGround: 10,
          countries: [],
          daysWithData: 2,
          daysPaused: 0,
          algorithm: 1,
          dayValues: dayValues === null ? Prisma.DbNull : (dayValues as Prisma.InputJsonValue),
        },
      });

    it("answers each recorded day's kilometres; a 0 day is recorded, an absent one is not", async () => {
      await month(userId, "2026-03-01", { "2026-03-04": 7.34, "2026-03-05": 0 });
      await month(otherId, "2026-04-01", { "2026-04-01": 3 });

      const res = await get("calendar", { year: "2026" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        year: 2026,
        days: [
          { day: "2026-03-04", kmGround: 7.3, recorded: true },
          { day: "2026-03-05", kmGround: 0, recorded: true },
        ],
        pending: [],
        unavailable: [],
      });
    });

    it("names a month still owed as pending, and one without day values as unavailable", async () => {
      await month(userId, "2026-05-01", null);
      await month(userId, "2026-06-01", null);
      await prisma.travTrackDirtyDay.create({
        data: { userId, day: utcMidnight("2026-06-03"), version: 1, done: 0 },
      });
      await prisma.travTrackDirtyDay.create({
        data: { userId, day: utcMidnight("2026-05-03"), version: 1, done: MONTHS_BIT },
      });

      const res = await get("calendar", { year: "2026" });

      expect(res.body).toEqual({
        year: 2026,
        days: [],
        pending: ["2026-06"],
        unavailable: ["2026-05"],
      });
    });

    it("refuses a year that is not one, and answers 403 while off", async () => {
      expect((await get("calendar", { year: "26" })).status).toBe(400);
      await switches.set({ beta: true, config: false });
      expect((await get("calendar", { year: "2026" })).status).toBe(403);
    });
  });
});

import request from "supertest";

import app from "../../index";
import { observeQueries, prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { setClockForTests } from "../../shared/time/clock";
import { clearGapCalendarCache } from "../../services/gapCalendar/cache";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /gap-calendar` (spec 2026-11-22-gap-calendar): per day of a year, what
 * explains it — and what does not. Real database, real SQL: the precedence is
 * decided in `classify.ts`, but which day a fix or an entry lands on is SQL.
 */

const PREFIX = "gap-calendar-";
const HOUR = 3_600_000;
/** The columns a flight row requires; each test names only what it is about. */
const AIRPORTS = { depLat: 37.469, depLon: 126.451, arrLat: 35.765, arrLon: 140.386 };

const ZONE = { lat: 37.55, lon: 126.99, radiusM: 500 };

describe("gap calendar", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;

  const year = (y = 2026, c = cookie) =>
    request(app)
      .get("/api/v1/gap-calendar")
      .query({ year: String(y) })
      .set("Cookie", c);

  type Body = { runs: Array<{ from: string; to: string; state: string }>; [k: string]: unknown };
  const stateOf = (body: Body, day: string) =>
    body.runs.find((r) => r.from <= day && day <= r.to)?.state;

  const setZone = async (zone: string, extra: object = {}) => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: zone } }, ...extra },
    });
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    setClockForTests("2026-11-22T12:00:00Z");
    await wipeTravTrack([userId, otherId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.travTrackPlaceSettings.deleteMany({ where: { userId } });
    await setZone("Asia/Seoul");
    // Last: the setup's own writes above must not leave their deferred drops in this test's way.
    clearGapCalendarCache();
  });

  afterAll(async () => {
    setClockForTests(null);
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("refuses an anonymous caller and a bad year", async () => {
    expect((await request(app).get("/api/v1/gap-calendar?year=2026")).status).toBe(401);
    expect((await year(1969)).status).toBe(400);
    expect((await request(app).get("/api/v1/gap-calendar").set("Cookie", cookie)).status).toBe(400);
  });

  it("an account with no record at all has no gap: every day is outside", async () => {
    const body = (await year()).body as Body;
    expect(body.firstDay).toBeNull();
    expect(body.years).toEqual([]);
    expect(body.runs).toEqual([{ from: "2026-01-01", to: "2026-12-31", state: "outside" }]);
  });

  it("marks entry days, unknown stretches between records, and keeps before-first and after-today out of the gaps", async () => {
    await makeFlight(userId); // 12 Oct 2026, Seoul
    await makeTrip(userId); // 11-14 Oct 2026
    await prisma.flight.create({
      data: {
        userId,
        ...AIRPORTS,
        depIata: "ICN",
        arrIata: "NRT",
        flightNumber: "KE1",
        departureTime: new Date("2026-03-05T01:00:00Z"),
        arrivalTime: new Date("2026-03-05T03:00:00Z"),
        status: "flown",
      },
    });
    const body = (await year()).body as Body;
    expect(body.firstDay).toBe("2026-03-05");
    expect(stateOf(body, "2026-03-04")).toBe("outside");
    expect(stateOf(body, "2026-03-05")).toBe("entry");
    expect(stateOf(body, "2026-03-06")).toBe("unknown");
    expect(stateOf(body, "2026-10-10")).toBe("unknown");
    for (const d of ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]) {
      expect(stateOf(body, d)).toBe("entry");
    }
    expect(stateOf(body, "2026-11-22")).toBe("unknown");
    expect(stateOf(body, "2026-11-23")).toBe("outside");
    expect(body.years).toEqual([2026]);
  });

  it("a cancelled flight covers nothing", async () => {
    await prisma.flight.create({
      data: {
        userId,
        ...AIRPORTS,
        depIata: "ICN",
        arrIata: "NRT",
        flightNumber: "KE2",
        departureTime: new Date("2026-05-05T01:00:00Z"),
        arrivalTime: new Date("2026-05-05T03:00:00Z"),
        status: "cancelled",
      },
    });
    const body = (await year()).body as Body;
    expect(body.firstDay).toBeNull();
  });

  it("a year-precision historical flight's Jan 1 placeholder does not cover that day", async () => {
    await prisma.flight.create({
      data: {
        userId,
        ...AIRPORTS,
        depIata: "ICN",
        arrIata: "NRT",
        flightNumber: "KE3",
        departureTime: new Date("2026-01-01T00:00:00Z"),
        depTimeSemantics: "UNKNOWN",
        depPrecision: "year",
        status: "flown",
      },
    });
    const body = (await year()).body as Body;
    expect(body.firstDay).toBeNull();
    expect(stateOf(body, "2026-01-01")).not.toBe("entry");
  });

  it("a month-precision flight and the legacy UNKNOWN placeholder shape cover no day either", async () => {
    for (const [n, precision] of [
      ["KE4", "month"],
      ["KE5", null],
    ] as const) {
      await prisma.flight.create({
        data: {
          userId,
          ...AIRPORTS,
          depIata: "ICN",
          arrIata: "NRT",
          flightNumber: n,
          departureTime: new Date("2026-03-01T00:00:00Z"),
          depTimeSemantics: "UNKNOWN",
          depPrecision: precision,
          status: "flown",
        },
      });
    }
    const body = (await year()).body as Body;
    expect(body.firstDay).toBeNull();
  });

  describe("TravTrack fixes", () => {
    it("a day with a plausible fix is track; an entry beats it", async () => {
      await storePoint(userId, { t: Date.parse("2026-06-10T03:00:00Z"), lat: 35.1, lon: 129.0 });
      await storePoint(userId, { t: Date.parse("2026-10-12T03:00:00Z"), lat: 35.1, lon: 129.0 });
      await makeFlight(userId); // 12 Oct
      const body = (await year()).body as Body;
      expect(stateOf(body, "2026-06-10")).toBe("track");
      expect(stateOf(body, "2026-06-11")).toBe("unknown");
      expect(stateOf(body, "2026-10-12")).toBe("entry");
    });

    it("home: every plausible fix inside the home period's residence; one fix away makes it a track day", async () => {
      await setZone("Asia/Seoul", {
        data: {
          display: { timezone: "Asia/Seoul" },
          homePeriods: [
            {
              fromDate: "2020-01-01",
              toDate: null,
              residence: { name: "Wohnung", lat: 37.5, lon: 127.0 },
              residenceConfirmed: true,
              airports: [{ code: "ICN", primary: true }],
            },
          ],
        },
      });
      await storePoint(userId, { t: Date.parse("2026-06-10T03:00:00Z"), lat: 37.5, lon: 127.0 });
      await storePoint(userId, { t: Date.parse("2026-06-11T03:00:00Z"), lat: 37.5, lon: 127.0 });
      await storePoint(userId, { t: Date.parse("2026-06-11T05:00:00Z"), lat: 37.6, lon: 127.1 });
      const body = (await year()).body as Body;
      expect(stateOf(body, "2026-06-10")).toBe("home");
      expect(stateOf(body, "2026-06-11")).toBe("track");
    });

    it("a day whose fixes all lie in a privacy zone is privacyZone and reveals no position or count", async () => {
      await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Heim", ...ZONE } });
      // 400 m from the zone centre: inside the 500 m radius.
      await storePoint(userId, {
        t: Date.parse("2026-06-10T03:00:00Z"),
        lat: 37.5536,
        lon: 126.99,
      });
      await storePoint(userId, {
        t: Date.parse("2026-06-10T04:00:00Z"),
        lat: 37.5536,
        lon: 126.99,
      });
      const res = await year();
      const body = res.body as Body;
      expect(stateOf(body, "2026-06-10")).toBe("privacyZone");
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/37\.55|126\.99/);
      expect(Object.keys(res.body).sort()).toEqual(
        ["counts", "firstDay", "runs", "today", "year", "years", "zone"].sort()
      );
    });

    it("zone boundary: a fix just outside the radius is a track day, one just inside is hidden", async () => {
      await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Heim", ...ZONE } });
      // ~0.001 deg latitude is ~111 m: 4.0 * 111 = 444 m inside, 5.4 * 111 = 600 m outside.
      await storePoint(userId, {
        t: Date.parse("2026-06-10T03:00:00Z"),
        lat: ZONE.lat + 0.004,
        lon: ZONE.lon,
      });
      await storePoint(userId, {
        t: Date.parse("2026-06-11T03:00:00Z"),
        lat: ZONE.lat + 0.0054,
        lon: ZONE.lon,
      });
      const body = (await year()).body as Body;
      expect(stateOf(body, "2026-06-10")).toBe("privacyZone");
      expect(stateOf(body, "2026-06-11")).toBe("track");
    });

    it("a former zone hides fixes from before it ended, not after", async () => {
      await prisma.travTrackZoneTombstone.create({
        data: { userId, ...ZONE, untilAt: new Date("2026-06-11T00:00:00Z") },
      });
      await storePoint(userId, {
        t: Date.parse("2026-06-10T03:00:00Z"),
        lat: ZONE.lat,
        lon: ZONE.lon,
      });
      await storePoint(userId, {
        t: Date.parse("2026-06-12T03:00:00Z"),
        lat: ZONE.lat,
        lon: ZONE.lon,
      });
      const body = (await year()).body as Body;
      expect(stateOf(body, "2026-06-10")).toBe("privacyZone");
      expect(stateOf(body, "2026-06-12")).toBe("track");
    });

    it("a fix without a reported accuracy still counts as a plausible fix", async () => {
      await storePoint(userId, {
        t: Date.parse("2026-06-10T03:00:00Z"),
        lat: 35.1,
        lon: 129.0,
        accuracyM: null,
      });
      expect(stateOf((await year()).body as Body, "2026-06-10")).toBe("track");
    });

    it("a day with only implausible fixes is implausible", async () => {
      await storePoint(userId, { t: Date.parse("2026-06-10T03:00:00Z"), lat: 0, lon: 0 });
      await storePoint(userId, {
        t: Date.parse("2026-06-11T03:00:00Z"),
        lat: 35.1,
        lon: 129.0,
        accuracyM: 50_000,
      });
      const body = (await year()).body as Body;
      expect(stateOf(body, "2026-06-10")).toBe("implausible");
      expect(stateOf(body, "2026-06-11")).toBe("implausible");
    });
  });

  describe.each([
    ["Pacific/Kiritimati", "2026-03-11", "2026-03-10"],
    ["America/St_Johns", "2026-03-10", "2026-03-11"],
    ["UTC", "2026-03-10", "2026-03-11"],
  ])("day boundaries in %s", (zone, trackDay, emptyDay) => {
    it("reads a fix and a flight on the profile zone's calendar day", async () => {
      await setZone(zone);
      clearGapCalendarCache();
      // 22:00Z on 10 Mar: 12:00 on 11 Mar in Kiritimati (+14), 18:30 on 10 Mar in St. John's (-3:30).
      await storePoint(userId, { t: Date.parse("2026-03-10T22:00:00Z"), lat: 35.1, lon: 129.0 });
      await storePoint(userId, { t: Date.parse("2026-04-10T22:00:00Z"), lat: 35.1, lon: 129.0 });
      const body = (await year()).body as Body;
      expect(stateOf(body, trackDay)).toBe("track");
      expect(stateOf(body, emptyDay)).not.toBe("track");
    });
  });

  it("flights use the airport's zone: a departure at 23:30Z lands on the next day in Tokyo", async () => {
    await prisma.flight.create({
      data: {
        userId,
        ...AIRPORTS,
        depIata: "NRT",
        arrIata: "NRT",
        flightNumber: "JL1",
        departureTime: new Date("2026-07-01T23:30:00Z"),
        arrivalTime: new Date("2026-07-02T00:30:00Z"),
        depTimezone: "Asia/Tokyo",
        arrTimezone: "Asia/Tokyo",
        status: "flown",
      },
    });
    await setZone("UTC");
    const body = (await year()).body as Body;
    expect(stateOf(body, "2026-07-01")).not.toBe("entry");
    expect(stateOf(body, "2026-07-02")).toBe("entry");
  });

  it("a cancelled cruise covers nothing, and a date-line flight that lands a day earlier still covers its days", async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.cruise.create({
      data: {
        userId,
        routeName: "Abgesagt",
        startDay: new Date("2026-02-01"),
        endDay: new Date("2026-02-09"),
        status: "cancelled",
      },
    });
    // Tokyo 18:00 on 3 Jul -> Honolulu 07:00 on 3 Jul local (the arrival's date is the earlier one
    // in UTC terms only after zone conversion: 21:00Z on 3 Jul is 11:00 on 3 Jul in Honolulu).
    await prisma.flight.create({
      data: {
        userId,
        ...AIRPORTS,
        depIata: "NRT",
        arrIata: "HNL",
        flightNumber: "JL2",
        departureTime: new Date("2026-07-03T23:00:00Z"),
        arrivalTime: new Date("2026-07-04T08:00:00Z"),
        depTimezone: "Asia/Tokyo",
        arrTimezone: "Pacific/Honolulu",
        status: "flown",
      },
    });
    await setZone("UTC");
    const body = (await year()).body as Body;
    expect(body.firstDay).toBe("2026-07-03");
    expect(stateOf(body, "2026-02-03")).toBe("outside");
    expect(stateOf(body, "2026-07-03")).toBe("entry");
    await prisma.cruise.deleteMany({ where: { userId } });
  });

  it("an unknown airport zone does not fail the calendar", async () => {
    await prisma.flight.create({
      data: {
        userId,
        ...AIRPORTS,
        depIata: "XXX",
        arrIata: "XXX",
        flightNumber: "ZZ1",
        departureTime: new Date("2026-07-01T10:00:00Z"),
        arrivalTime: new Date("2026-07-01T11:00:00Z"),
        depTimezone: "Mars/Olympus",
        status: "flown",
      },
    });
    const res = await year();
    expect(res.status).toBe(200);
    expect(stateOf(res.body as Body, "2026-07-01")).toBe("entry");
  });

  it("another account's records never colour this account's calendar", async () => {
    await storePoint(otherId, { t: Date.parse("2026-06-10T03:00:00Z"), lat: 35.1, lon: 129.0 });
    const body = (await year()).body as Body;
    expect(body.firstDay).toBeNull();
  });

  describe("cost and cache", () => {
    const queriesOf = async (): Promise<number> => {
      clearGapCalendarCache();
      let n = 0;
      const stop = observeQueries(() => {
        n += 1;
      });
      try {
        expect((await year(2015)).status).toBe(200);
      } finally {
        stop();
      }
      return n;
    };

    it("a 20-year account costs the same number of queries as an empty one", async () => {
      const empty = await queriesOf();
      const start = Date.parse("2006-01-01T12:00:00Z");
      const points = Array.from({ length: 1500 }, (_, i) => {
        const t = start + i * 4.8 * 24 * HOUR;
        return {
          userId,
          t: new Date(t),
          tS: Math.floor(t / 1000),
          lat: 35 + (i % 50) / 100,
          lon: 129 + (i % 70) / 100,
          origin: "companion:phone-1",
          originRef: `gap-${i}`,
        };
      });
      await prisma.travTrackPoint.createMany({ data: points });
      await prisma.flight.createMany({
        data: Array.from({ length: 400 }, (_, i) => ({
          userId,
          ...AIRPORTS,
          depIata: "ICN",
          arrIata: "NRT",
          flightNumber: `KE${i}`,
          departureTime: new Date(start + i * 18 * 24 * HOUR),
          arrivalTime: new Date(start + i * 18 * 24 * HOUR + 2 * HOUR),
          status: "flown",
        })),
      });
      const full = await queriesOf();
      expect(full).toBe(empty);
      expect(full).toBeLessThanOrEqual(5);
      const body = (await year(2015)).body as Body;
      expect(body.firstDay).toBe("2006-01-01");
      expect((body.years as number[])[0]).toBe(2006);
      expect(body.runs.some((r) => r.state === "track")).toBe(true);
    });

    it("serves the second read from the cache and drops it when the user writes a source row", async () => {
      await makeFlight(userId);
      let raw = 0;
      const stop = observeQueries((q) => {
        if (q.model === undefined) raw += 1;
      });
      try {
        await year();
        const first = raw;
        await year();
        expect(raw).toBe(first);
        await prisma.trip.create({
          data: {
            userId,
            name: "Nu",
            startDay: new Date("2026-09-01"),
            endDay: new Date("2026-09-03"),
          },
        });
        const body = (await year()).body as Body;
        expect(raw).toBeGreaterThan(first);
        expect(stateOf(body, "2026-09-02")).toBe("entry");
      } finally {
        stop();
      }
    });
  });
});

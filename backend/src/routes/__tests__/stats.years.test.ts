import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { yearStatsSchema } from "../../schemas/statsYears";

/**
 * GET /stats/years: distance per year and month across the domains. The pure rules are tested
 * in `utils/stats/__tests__/yearStats.test.ts`; this drives the loaders, the filters and the
 * empty account through the route.
 */
describe("GET /stats/years", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  let userId: string;
  let emptyId: string;
  const cookieOf = (id: string): string => `auth_token=${generateToken(id)}`;
  const get = (id: string, query = "") =>
    request(app).get(`/api/v1/stats/years${query}`).set("Cookie", cookieOf(id));

  const make = async (name: string): Promise<string> => {
    const u = await prisma.user.create({
      data: { username: `${name}-${stamp}`, passwordHash: await hashPassword("pw123456") },
    });
    ids.push(u.id);
    return u.id;
  };
  const rail = (extra: Record<string, unknown>) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "A",
        depLat: 48,
        depLon: 11,
        depCountry: "DE",
        arrStationName: "B",
        arrLat: 50,
        arrLon: 8,
        arrCountry: "DE",
        status: "completed",
        distanceKm: 100,
        departureTime: new Date("2024-03-10T08:00:00Z"),
        arrivalTime: new Date("2024-03-10T10:00:00Z"),
        ...extra,
      },
    });

  beforeAll(async () => {
    userId = await make("years-full");
    emptyId = await make("years-empty");
    await prisma.userSettings.createMany({
      data: [
        { userId, enabledDomains: ["flight", "rail"], data: {} },
        { userId: emptyId, enabledDomains: ["flight", "rail"], data: {} },
      ],
    });
    // Frankfurt -> Rome, March 2024 (a measurable great-circle distance).
    await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "FCO",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 41.8,
        arrLon: 12.25,
        departureTime: new Date("2024-03-01T08:00:00Z"),
        arrivalTime: new Date("2024-03-01T10:00:00Z"),
        depTimezone: "Europe/Berlin",
        arrTimezone: "Europe/Rome",
        status: "flown",
      },
    });
    // New Year's Eve in Berlin: 23:30 local on 31 Dec is already 2025 in UTC only for zones east of it.
    await rail({ distanceKm: 100 });
    await rail({
      distanceKm: 40,
      departureTime: new Date("2025-01-01T00:30:00Z"),
      arrivalTime: new Date("2025-01-01T02:00:00Z"),
      depTimezone: "America/New_York", // 31 Dec 2024 19:30 local: belongs to 2024-12
    });
    // Remembered (typed from memory) and business: both are filters on this statistic.
    await rail({ distanceKm: 1000, provenance: "remembered" });
    await rail({ distanceKm: 2000, purpose: "business" });
    // A year in which nothing was measured.
    await rail({
      distanceKm: null,
      departureTime: new Date("2021-06-01T08:00:00Z"),
      arrivalTime: new Date("2021-06-01T09:00:00Z"),
    });
    // A domain the account has switched off must not appear.
    await prisma.busJourney.create({
      data: {
        userId,
        depStationName: "A",
        depLat: 48,
        depLon: 11,
        arrStationName: "B",
        arrLat: 50,
        arrLon: 8,
        status: "completed",
        distanceKm: 7000,
        departureTime: new Date("2024-03-12T08:00:00Z"),
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("aggregates per year and month, in the contract's shape", async () => {
    const res = await get(userId);
    expect(res.status).toBe(200);
    expect(yearStatsSchema.safeParse(res.body).success).toBe(true);
    const y24 = res.body.years.find((y: { year: number }) => y.year === 2024);
    const march = y24.months[2];
    expect(march.byDomain.rail).toBe(3100); // 100 + 1000 + 2000
    expect(march.byDomain.flight).toBeGreaterThan(900);
    expect(march.byDomain.flight).toBeLessThan(1100);
    expect(march.byDomain.bus).toBeUndefined(); // bus is switched off for this account
    // 40 km at 19:30 on 31 Dec on the New York clock: December 2024, not January 2025.
    expect(y24.months[11].byDomain.rail).toBe(40);
    expect(res.body.years.map((y: { year: number }) => y.year)).toEqual([2024, 2021]);
  });

  it("onlyRecorded=true drops entries typed in from memory", async () => {
    const res = await get(userId, "?onlyRecorded=true");
    const march = res.body.years.find((y: { year: number }) => y.year === 2024).months[2];
    expect(march.byDomain.rail).toBe(2100);
  });

  it("a hidden purpose leaves its entries out", async () => {
    await request(app)
      .put("/api/v1/purpose/visibility")
      .set("Cookie", cookieOf(userId))
      .send({ rail: ["business"] })
      .expect(200);
    const res = await get(userId);
    const march = res.body.years.find((y: { year: number }) => y.year === 2024).months[2];
    expect(march.byDomain.rail).toBe(1100);
    await request(app)
      .put("/api/v1/purpose/visibility")
      .set("Cookie", cookieOf(userId))
      .send({})
      .expect(200);
  });

  it("a year with entries but no measured distance says null, not 0", async () => {
    const y21 = (await get(userId)).body.years.find((y: { year: number }) => y.year === 2021);
    expect(y21.loggedKm).toBeNull();
    expect(y21.months.every((m: { loggedKm: number | null }) => m.loggedKm === null)).toBe(true);
  });

  it("an account with nothing answers empty years and null totals", async () => {
    const res = await get(emptyId);
    expect(res.status).toBe(200);
    expect(res.body.years).toEqual([]);
    expect(res.body.totals).toEqual({ loggedKm: null, recordedKm: null, recordedPoints: null });
  });

  it("answers 304 for an unchanged account and 401 without a session", async () => {
    const first = await get(userId);
    const again = await request(app)
      .get("/api/v1/stats/years")
      .set("Cookie", cookieOf(userId))
      .set("If-None-Match", first.headers.etag);
    expect(again.status).toBe(304);
    expect((await request(app).get("/api/v1/stats/years")).status).toBe(401);
  });

  it("the rail list narrows to a month of the year on the departure station's clock", async () => {
    const ids = async (query: string): Promise<number> =>
      (await request(app).get(`/api/v1/rail?${query}`).set("Cookie", cookieOf(userId)).expect(200))
        .body.data.length;
    // March 2024 holds four rides (100, 1000, 2000 km and the 2021-free ones are elsewhere);
    // the New York ride is December 2024 on its own clock.
    expect(await ids("year=2024&month=3&limit=50")).toBe(3);
    expect(await ids("year=2024&month=12&limit=50")).toBe(1);
    expect(await ids("year=2024&month=7&limit=50")).toBe(0);
    expect(await ids("year=2024&limit=50")).toBe(4);
  });
});

/**
 * AUD-077. Three endpoints answered "which year did I fly in" three ways.
 *
 * `/stats/timeseries` buckets on the departure airport's calendar day, which is
 * the rule `services/stats/departureClock.ts` states. `/stats/summary` filtered
 * the stored UTC instant against UTC year boundaries, and `/stats/wrapped`
 * grouped on `getUTCFullYear()`. The stored instant and the local day disagree
 * by up to fourteen hours, so a flight either side of New Year landed in a
 * different year depending on which figure you looked at — and `wrapped` would
 * not even offer the year as available.
 *
 * The two flights below are Codex's, one leaning each way, so a fix that merely
 * shifted the boundary rather than resolving the clock fails on one of them.
 * The assertion is agreement between the three endpoints, not a hand-computed
 * constant.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "yearislocaldeparture";

describe("a flight belongs to the year it departed in locally", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.createMany({
      data: [
        {
          // Bangkok (UTC+7), 01:30 local on 1 January 2025 — stored as
          // 18:30Z on 31 December 2024. Belongs to 2025.
          userId: user.id,
          status: "flown",
          flightNumber: "TG920",
          depIata: "BKK",
          arrIata: "MUC",
          depLat: 13.6811,
          depLon: 100.7473,
          arrLat: 48.3538,
          arrLon: 11.7861,
          departureTime: new Date("2024-12-31T18:30:00Z"),
          arrivalTime: new Date("2025-01-01T02:30:00Z"),
        },
        {
          // Los Angeles (UTC-8), 20:30 local on 31 December 2024 — stored as
          // 04:30Z on 1 January 2025. Belongs to 2024.
          userId: user.id,
          status: "flown",
          flightNumber: "UA1",
          depIata: "LAX",
          arrIata: "SFO",
          depLat: 33.9425,
          depLon: -118.408,
          arrLat: 37.6213,
          arrLon: -122.379,
          departureTime: new Date("2025-01-01T04:30:00Z"),
          arrivalTime: new Date("2025-01-01T05:30:00Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  // The two flights differ by an order of magnitude in distance ON PURPOSE.
  // Both years hold exactly one flight either way, so a COUNT cannot tell a
  // correct answer from a swapped one — an earlier version of this test passed
  // with the fix reverted for exactly that reason. Distance names which flight
  // was counted, which is the actual claim.
  const BANGKOK_KM = 8500; // BKK -> MUC, roughly
  const LOS_ANGELES_KM = 550; // LAX -> SFO, roughly

  const summary = async (
    year: number
  ): Promise<{ totalFlights: number; totalDistance: number }> => {
    const res = await request(app).get(`/api/v1/stats/summary?year=${year}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body;
  };

  it("counts the Bangkok departure in 2025, not 2024", async () => {
    const y = await summary(2025);
    expect(y.totalFlights).toBe(1);
    expect(y.totalDistance).toBeGreaterThan(BANGKOK_KM * 0.9);
  });

  it("counts the Los Angeles departure in 2024, not 2025", async () => {
    const y = await summary(2024);
    expect(y.totalFlights).toBe(1);
    expect(y.totalDistance).toBeLessThan(LOS_ANGELES_KM * 1.5);
  });

  it("agrees with the year in review about which year each belongs to", async () => {
    const res = await request(app).get("/api/v1/stats/wrapped?year=2025").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.flights).toBe(1);
    expect(res.body.availableYears).toEqual([2024, 2025]);
    // Again distance, not count: with the year read off the stored instant the
    // two flights merely swap years and every count stays 1.
    expect(res.body.distanceKm).toBeGreaterThan(BANGKOK_KM * 0.9);
  });

  it("agrees with the trend chart, which has always used the local day", async () => {
    // `window=year` with `year=` is the bounded form; the default is a rolling
    // twelve months from today, which would answer about 2026.
    const res = await request(app)
      .get("/api/v1/stats/timeseries?window=year&year=2025&granularity=year")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    const series = res.body.series as { count: number; distanceKm: number }[];
    const total = series.reduce((sum, p) => sum + p.count, 0);
    const distance = series.reduce((sum, p) => sum + p.distanceKm, 0);
    const fromSummary = await summary(2025);
    expect(total).toBe(fromSummary.totalFlights);
    expect(distance).toBeCloseTo(fromSummary.totalDistance, 0);
    expect(distance).toBeGreaterThan(BANGKOK_KM * 0.9);
  });
});

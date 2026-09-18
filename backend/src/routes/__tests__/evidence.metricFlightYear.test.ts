import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { calculateDistance } from "../../utils/geo";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence, `FlightYearSummaryCards` family (task-7-brief.md):
 * `yearFlightCount`, `yearDistanceKm`, `yearFlightTimeMinutes`,
 * `yearTotalCost`, `yearUnpricedFlightCount` — all fed by
 * `services/stats/summary.ts` `computeSummary`, scoped to ONE calendar year.
 * A flight outside the requested year, and one inside it but excluded by
 * `countableFlightWhere()`, both prove the scope is honoured rather than
 * merely requested.
 */
describe("GET /api/v1/evidence/metric/... — the FlightYearSummaryCards family", () => {
  let userAId: string;
  let userACookie: string;

  function flightFixture(
    userId: string,
    day: string,
    overrides: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      userId,
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 51.47,
      arrLon: -0.4543,
      depIata: "FRA",
      arrIata: "LHR",
      departureTime: new Date(`${day}T08:00:00Z`),
      arrivalTime: new Date(`${day}T09:30:00Z`),
      status: "flown",
      ...overrides,
    };
  }

  const singleLegDistanceKm = calculateDistance(50.0379, 8.5622, 51.47, -0.4543);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencemetricyearA" } });
    const userA = await prisma.user.create({
      data: { username: "evidencemetricyearA", passwordHash: await hashPassword("password123") },
    });
    userAId = userA.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;

    await prisma.flight.createMany({
      data: [
        // In 2025, priced.
        flightFixture(userAId, "2025-01-10", {
          flightNumber: "MY100",
          price: 100,
          currency: "EUR",
        }),
        // In 2025, unpriced.
        flightFixture(userAId, "2025-02-10", { flightNumber: "MY101" }),
        // Outside 2025 — must not contribute to any 2025 figure.
        flightFixture(userAId, "2024-12-10", {
          flightNumber: "MY-2024",
          price: 50,
          currency: "EUR",
        }),
        // In 2025, but cancelled — excluded by `countableFlightWhere()`.
        flightFixture(userAId, "2025-03-10", {
          flightNumber: "MY999",
          status: "cancelled",
          price: 999,
          currency: "EUR",
        }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: userAId } });
    await prisma.user.deleteMany({ where: { id: userAId } });
  });

  it("yearFlightCount: counts only the two countable 2025 flights", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearFlightCount?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(2);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers.sort()).toEqual(["MY100", "MY101"]);
    assertSumInvariant(res.body, Math.round);
  });

  it("yearDistanceKm: sums the distance of the two 2025 flights only", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearDistanceKm?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(Math.round(singleLegDistanceKm * 2));
    assertSumInvariant(res.body, Math.round);
  });

  it("yearFlightTimeMinutes: 90 minutes each for the two 2025 flights", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearFlightTimeMinutes?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(180);
    assertSumInvariant(res.body, Math.round);
  });

  it("yearTotalCost: sums only MY100's 100 EUR — the 2024 and cancelled prices never enter", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearTotalCost?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(100);
    assertSumInvariant(res.body, (n: number) => Math.round(n * 100) / 100);
  });

  it("yearUnpricedFlightCount: MY101 has no price and is the only unpriced 2025 flight", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearUnpricedFlightCount?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toEqual(["MY101"]);
    assertSumInvariant(res.body, Math.round);
  });

  it("a year with no flights at all answers 200 with value 0, not 404", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearFlightCount?period=year&year=2019")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it("answers 400, not 404, when this family is asked for allTime instead of a year", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/yearFlightCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period=year/);
  });
});

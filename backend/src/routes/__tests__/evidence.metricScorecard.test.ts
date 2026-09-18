import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence, `scorecard/FlightScorecardBlock` family (task-7-brief.md):
 * `scorecardFlightCount`, `scorecardDistanceKm`, `scorecardFlightTimeMinutes`
 * — the ONE flight-tab surface that is genuinely user-selectable across
 * `allTime`/`year`/`rolling12m` (registry `scopes: ["rolling12m", "year",
 * "allTime"]`). A flight recent enough for `allTime` and `rolling12m` but
 * NOT the requested year, and a flight in the requested year but too old
 * for `rolling12m`, are what tell the three scopes apart.
 */
describe("GET /api/v1/evidence/metric/... — the FlightScorecardBlock family", () => {
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

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencemetricscorecardA" } });
    const userA = await prisma.user.create({
      data: {
        username: "evidencemetricscorecardA",
        passwordHash: await hashPassword("password123"),
      },
    });
    userAId = userA.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;

    await prisma.flight.createMany({
      data: [
        // A very old flight — inside allTime, outside both bounded windows.
        flightFixture(userAId, "2010-01-10", { flightNumber: "SC-OLD" }),
        // 2025 flight — inside allTime and year=2025; rolling12m depends on
        // "now", so this test only asserts allTime/year, not rolling12m's
        // exact membership for a fixed fixture date.
        flightFixture(userAId, "2025-06-10", { flightNumber: "SC-2025" }),
        // A different year — inside allTime, outside year=2025.
        flightFixture(userAId, "2023-06-10", { flightNumber: "SC-2023" }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: userAId } });
    await prisma.user.deleteMany({ where: { id: userAId } });
  });

  it("allTime: counts every countable flight regardless of how old it is", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/scorecardFlightCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(3);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers.sort()).toEqual(["SC-2023", "SC-2025", "SC-OLD"]);
    assertSumInvariant(res.body, (n: number) => n);
  });

  it("year=2025: only SC-2025, not the 2010 or 2023 flights", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/scorecardFlightCount?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toEqual(["SC-2025"]);
    assertSumInvariant(res.body, (n: number) => n);
  });

  it("rolling12m: excludes the 2010 and 2023 flights, which are older than 12 months from any 'now'", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/scorecardFlightCount?period=rolling12m")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("SC-OLD");
    expect(flightNumbers).not.toContain("SC-2023");
    assertSumInvariant(res.body, (n: number) => n);
  });

  it("scorecardDistanceKm holds the raw (unrounded) sum invariant for allTime", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/scorecardDistanceKm")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    assertSumInvariant(res.body, (n: number) => n);
  });

  it("scorecardFlightTimeMinutes: 90 measured minutes per flight, summed over allTime", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/scorecardFlightTimeMinutes")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(90 * 3);
    assertSumInvariant(res.body, (n: number) => n);
  });
});

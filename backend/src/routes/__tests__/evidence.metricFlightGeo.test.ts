import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertDistinctInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence, flight-tab geo distinct family (task-7-brief.md):
 * `airportsVisitedCount`, `flightCountriesVisitedCount`,
 * `continentsVisitedCount` — all mirroring `calculateAirportStats`'s own
 * per-flight bump, which never de-duplicates a flight's two ends against
 * EACH OTHER before crediting. A domestic flight (FRA→MUC, both Germany,
 * both Europe) is the fixture that tells "one credit per union" apart from
 * "one credit per row".
 */
describe("GET /api/v1/evidence/metric/... — the flight-tab geo distinct family", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;

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
    await prisma.user.deleteMany({
      where: { username: { in: ["evidencemetricgeoA", "evidencemetricgeoB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidencemetricgeoA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidencemetricgeoB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        // Germany -> UK, Europe -> Europe. Credits FRA, LHR, DE, GB, and
        // Europe once (dep and arr continent are the same, so the union
        // keeps a single "Europe" credit, not two).
        flightFixture(userAId, "2025-01-10", { flightNumber: "MG100" }),
        // Domestic within Germany, both airports German and European — must
        // credit DE/Europe exactly ONCE despite touching two airports, and
        // must credit MUC as a NEW airport.
        flightFixture(userAId, "2025-02-10", {
          arrIata: "MUC",
          arrLat: 48.3538,
          arrLon: 11.7861,
          flightNumber: "MG101",
        }),
        // Touches everything the others do but is excluded by
        // `countableFlightWhere()` — must not leak into any of the three.
        flightFixture(userAId, "2025-03-10", {
          arrIata: "JFK",
          arrLat: 40.6398,
          arrLon: -73.7789,
          flightNumber: "MG999",
          status: "cancelled",
        }),
      ],
    });

    // User B's own, unrelated flight — the cross-user probe below.
    await prisma.flight.create({
      data: flightFixture(userBId, "2025-01-15", { flightNumber: "GB100" }),
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  it("airportsVisitedCount: FRA, LHR, MUC — three distinct airports across two flights", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/airportsVisitedCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(3);
    assertDistinctInvariant(res.body);
  });

  it("flightCountriesVisitedCount: credits DE exactly once for the domestic flight, plus GB — two countries total", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flightCountriesVisitedCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(2);
    const domestic = res.body.entries.find(
      (e: { title: { text: string } }) => e.title.text === "MG101"
    );
    expect(domestic).toBeDefined();
    expect(domestic.credits).toEqual(["DE"]);
    assertDistinctInvariant(res.body);
  });

  it("continentsVisitedCount: both flights stay within Europe — exactly one continent, not two", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/continentsVisitedCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    assertDistinctInvariant(res.body);
  });

  it("never leaks user A's airports into user B's own distinct count", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/airportsVisitedCount")
      .set("Cookie", userBCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(2); // FRA, LHR only
  });
});

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * The country resolver (`.superpowers/sdd/2026-09-18-evidence-panel/task-6-brief.md`).
 * `GET /stats/countries` (`routes/stats.ts`) folds a flight's two ends into a
 * per-flight `Set` BEFORE counting, unlike the airport resolver's sibling
 * suite — a domestic flight (both ends in the same country) must contribute
 * exactly ONE, not two, which is the opposite of the airport case and the
 * reason this dimension gets its own fixtures rather than reusing the
 * airport suite's.
 */
describe("GET /api/v1/evidence/ranking/country:... — the country resolver", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;

  interface FlightFixtureOverrides {
    depIata?: string;
    arrIata?: string;
    flightNumber?: string;
    status?: string;
    departureTime?: Date;
  }

  function flightFixture(userId: string, overrides: FlightFixtureOverrides) {
    return {
      userId,
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 51.47,
      arrLon: -0.4543,
      depIata: "FRA",
      arrIata: "LHR",
      departureTime: new Date("2025-01-01T08:00:00Z"),
      arrivalTime: new Date("2025-01-01T09:30:00Z"),
      status: "flown",
      ...overrides,
    };
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["evidencecountryA", "evidencecountryB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidencecountryA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidencecountryB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        // Germany (departure) and the UK (arrival) — one credit each.
        flightFixture(userAId, {
          depIata: "FRA",
          arrIata: "LHR",
          flightNumber: "CF100",
          departureTime: new Date("2025-01-10T08:00:00Z"),
        }),
        // Domestic within Germany — MUST credit Germany exactly ONCE, even
        // though the flight touches two German airports.
        flightFixture(userAId, {
          depIata: "FRA",
          arrIata: "MUC",
          flightNumber: "CF200",
          departureTime: new Date("2025-02-10T08:00:00Z"),
        }),
        // Touches Germany, but `countableFlightWhere()` excludes it.
        flightFixture(userAId, {
          depIata: "FRA",
          arrIata: "LHR",
          flightNumber: "CF999",
          status: "cancelled",
        }),
      ],
    });

    // User B's own, unrelated Germany-touching flight.
    await prisma.flight.create({
      data: flightFixture(userBId, {
        depIata: "FRA",
        arrIata: "LHR",
        flightNumber: "BF-C100",
      }),
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  async function germanyRankingRow(cookie: string) {
    const res = await request(app).get("/api/v1/stats/countries").set("Cookie", cookie);
    const row = res.body.countries.find((c: { country: string }) => c.country === "DE");
    expect(row).toBeDefined();
    return row as { country: string; count: number };
  }

  it("holds the sum invariant against the ranking's own flight count", async () => {
    const row = await germanyRankingRow(userACookie);
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:DE")
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    // CF100 (touches DE once) + CF200 (domestic DE, still once) = 2.
    expect(row.count).toBe(2);
    expect(res.body.measure.value).toBe(row.count);
    assertSumInvariant(res.body, Math.round);
  });

  it("credits a domestic flight to its country exactly ONCE, not twice for its two airports", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:DE")
      .set("Cookie", userACookie);

    const domestic = res.body.entries.find(
      (e: { title: { text: string } }) => e.title.text === "CF200"
    );
    expect(domestic).toBeDefined();
    expect(domestic.contribution).toBe(1);

    const entriesForFlight = res.body.entries.filter(
      (e: { title: { text: string } }) => e.title.text === "CF200"
    );
    expect(entriesForFlight).toHaveLength(1);
  });

  it("also credits the UK for the same international flight", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:GB")
      .set("Cookie", userACookie);

    expect(res.body.measure.value).toBe(1);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toContain("CF100");
  });

  it("excludes a flight countableFlightWhere() excludes, even though it touches the country", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:DE")
      .set("Cookie", userACookie);

    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("CF999");
  });

  it("never leaks user A's flights into user B's evidence for the same country", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:DE")
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    // User B's own single Germany-touching flight is legitimately theirs...
    expect(res.body.measure.value).toBe(1);
    // ...but none of user A's Germany-touching flight ids appear here.
    const flightsA = await prisma.flight.findMany({
      where: { userId: userAId, flightNumber: { in: ["CF100", "CF200"] } },
      select: { id: true },
    });
    const returnedIds = res.body.entries.map((e: { id: string }) => e.id);
    for (const f of flightsA) expect(returnedIds).not.toContain(f.id);
  });

  it("answers 200 with value 0, not 404, for a real country this user never touched", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:US")
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it("answers 400, not 404, for a scope this ranking does not measure", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/country:DE?period=year&year=2025")
      .set("Cookie", userACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period=allTime/);
  });
});

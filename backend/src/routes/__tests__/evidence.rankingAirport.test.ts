import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * The airport resolver (`.superpowers/sdd/2026-09-18-evidence-panel/task-6-brief.md`).
 * `calculateAirportStats` (`utils/stats/airportStats.ts`) bumps `dep` and
 * `arr` independently with no per-flight de-duplication, so a flight whose
 * departure and arrival are the SAME airport credits it TWICE. Every test
 * below names the way a naive "one flight, one credit" implementation would
 * get this wrong.
 */
describe("GET /api/v1/evidence/ranking/airport:... — the airport resolver", () => {
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
      where: { username: { in: ["evidenceairportA", "evidenceairportB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidenceairportA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidenceairportB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        // FRA is the departure only — one credit.
        flightFixture(userAId, {
          depIata: "FRA",
          arrIata: "LHR",
          flightNumber: "AF100",
          departureTime: new Date("2025-01-10T08:00:00Z"),
        }),
        // FRA is BOTH ends — the case task-6-brief.md names explicitly: one
        // flight, one row, contribution 2, and the row must say why.
        flightFixture(userAId, {
          depIata: "FRA",
          arrIata: "FRA",
          flightNumber: "AF200",
          departureTime: new Date("2025-02-10T08:00:00Z"),
        }),
        // FRA is the arrival only — one credit, the other direction.
        flightFixture(userAId, {
          depIata: "LHR",
          arrIata: "FRA",
          flightNumber: "AF300",
          departureTime: new Date("2025-03-10T08:00:00Z"),
        }),
        // Touches FRA on departure, but `countableFlightWhere()` excludes
        // it — must not inflate the FRA total.
        flightFixture(userAId, {
          depIata: "FRA",
          arrIata: "LHR",
          flightNumber: "AF999",
          status: "cancelled",
        }),
        // Unrelated to FRA entirely — proves no cross-airport leakage.
        flightFixture(userAId, {
          depIata: "MUC",
          arrIata: "MUC",
          flightNumber: "AF400",
        }),
      ],
    });

    // User B's own, unrelated FRA flight.
    await prisma.flight.create({
      data: flightFixture(userBId, {
        depIata: "FRA",
        arrIata: "LHR",
        flightNumber: "BF100",
      }),
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  async function fraRankingRow(cookie: string) {
    const res = await request(app).get("/api/v1/stats/airports").set("Cookie", cookie);
    const row = res.body.topAirports.find((a: { code: string }) => a.code === "FRA");
    expect(row).toBeDefined();
    return row as { code: string; visits: number };
  }

  it("holds the sum invariant against the ranking's own visit count", async () => {
    const row = await fraRankingRow(userACookie);
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:FRA")
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    // AF100 (dep, +1) + AF200 (both, +2) + AF300 (arr, +1) = 4.
    expect(row.visits).toBe(4);
    expect(res.body.measure.value).toBe(row.visits);
    assertSumInvariant(res.body, Math.round);
  });

  it("credits a round trip through the same airport TWICE, from ONE entry, and names both endpoints", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:FRA")
      .set("Cookie", userACookie);

    const entry = res.body.entries.find(
      (e: { title: { text: string } }) => e.title.text === "AF200"
    );
    expect(entry).toBeDefined();
    expect(entry.contribution).toBe(2);
    expect(entry.subtitle.values.role).toBe("both");
    expect(entry.subtitle.values.dep).toBe("FRA");
    expect(entry.subtitle.values.arr).toBe("FRA");

    // Exactly one entry for this flight — contribution 2 is not two rows.
    const entriesForFlight = res.body.entries.filter(
      (e: { title: { text: string } }) => e.title.text === "AF200"
    );
    expect(entriesForFlight).toHaveLength(1);
  });

  it("names the departure-only and arrival-only credits distinctly", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:FRA")
      .set("Cookie", userACookie);

    const depOnly = res.body.entries.find(
      (e: { title: { text: string } }) => e.title.text === "AF100"
    );
    const arrOnly = res.body.entries.find(
      (e: { title: { text: string } }) => e.title.text === "AF300"
    );
    expect(depOnly.contribution).toBe(1);
    expect(depOnly.subtitle.values.role).toBe("departure");
    expect(arrOnly.contribution).toBe(1);
    expect(arrOnly.subtitle.values.role).toBe("arrival");
  });

  it("excludes a flight countableFlightWhere() excludes, even though it touches the airport", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:FRA")
      .set("Cookie", userACookie);

    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("AF999");
    expect(flightNumbers).not.toContain("AF400");
  });

  it("never leaks user A's flights into user B's evidence for the same airport", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:FRA")
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    // User B's own single FRA departure is legitimately theirs...
    expect(res.body.measure.value).toBe(1);
    // ...but none of user A's FRA-touching flight ids appear here.
    const flightsA = await prisma.flight.findMany({
      where: { userId: userAId, flightNumber: { in: ["AF100", "AF200", "AF300"] } },
      select: { id: true },
    });
    const returnedIds = res.body.entries.map((e: { id: string }) => e.id);
    for (const f of flightsA) expect(returnedIds).not.toContain(f.id);
  });

  it("answers 200 with value 0, not 404, for a real airport code this user never touched", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:ZRH")
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it("answers 400, not 404, for a scope this ranking does not measure", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airport:FRA?period=year&year=2025")
      .set("Cookie", userACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period=allTime/);
  });
});

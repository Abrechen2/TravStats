import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * The aircraft-type resolver (`.superpowers/sdd/2026-09-18-evidence-panel/task-6-brief.md`).
 * `GET /stats/aircraft-types` (`routes/stats/aircraft.ts`) groups by the
 * stored `aircraft` string RAW — it never calls the achievement-side
 * `normalizeAircraft`. The suite's central case pins that: two spellings
 * that WOULD normalise to the same aircraft must stay in two separate
 * evidence rows, because they are two separate ranking rows.
 */
describe("GET /api/v1/evidence/ranking/aircraftType:... — the aircraft-type resolver", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;

  interface FlightFixtureOverrides {
    aircraft?: string | null;
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
      where: { username: { in: ["evidenceacftA", "evidenceacftB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidenceacftA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidenceacftB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        flightFixture(userAId, {
          aircraft: "A320neo",
          flightNumber: "AT100",
          departureTime: new Date("2025-01-10T08:00:00Z"),
        }),
        flightFixture(userAId, {
          aircraft: "A320neo",
          flightNumber: "AT101",
          departureTime: new Date("2025-02-10T08:00:00Z"),
        }),
        // A DIFFERENT raw spelling that a normalising resolver would fold
        // into the same group as "A320neo" above — it must stay in its
        // OWN row, because the ranking's `groupBy(["aircraft"])` keeps it
        // apart.
        flightFixture(userAId, {
          aircraft: "Airbus A320neo",
          flightNumber: "AT102",
          departureTime: new Date("2025-03-10T08:00:00Z"),
        }),
        // No aircraft on file at all — the ranking's own `aircraft: { not:
        // null } }` excludes it, and so must this resolver.
        flightFixture(userAId, { aircraft: null, flightNumber: "AT103" }),
        // Same spelling as the target row, but `countableFlightWhere()`
        // excludes it.
        flightFixture(userAId, {
          aircraft: "A320neo",
          flightNumber: "AT999",
          status: "cancelled",
        }),
      ],
    });

    // User B's own, unrelated A320neo flight.
    await prisma.flight.create({
      data: flightFixture(userBId, { aircraft: "A320neo", flightNumber: "BT100" }),
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  async function a320neoRankingRow(cookie: string) {
    const res = await request(app).get("/api/v1/stats/aircraft-types").set("Cookie", cookie);
    const row = res.body.aircraftTypes.find((a: { aircraft: string }) => a.aircraft === "A320neo");
    expect(row).toBeDefined();
    return row as { aircraft: string; count: number };
  }

  it("holds the sum invariant against the ranking's own count", async () => {
    const row = await a320neoRankingRow(userACookie);
    const res = await request(app)
      .get("/api/v1/evidence/ranking/aircraftType:A320neo")
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    // AT100 + AT101 only — AT102 is a different raw spelling.
    expect(row.count).toBe(2);
    expect(res.body.measure.value).toBe(row.count);
    assertSumInvariant(res.body, Math.round);

    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers.sort()).toEqual(["AT100", "AT101"]);
  });

  it("keeps a spelling that would normalise the same in its OWN, separate row", async () => {
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/${encodeURIComponent("aircraftType:Airbus A320neo")}`)
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toEqual(["AT102"]);
    // Neither AT100 nor AT101 (the "A320neo" spelling) leaked in here.
    expect(flightNumbers).not.toContain("AT100");
    expect(flightNumbers).not.toContain("AT101");
  });

  it("excludes a null-aircraft flight and a countableFlightWhere()-excluded flight", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/aircraftType:A320neo")
      .set("Cookie", userACookie);

    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("AT103");
    expect(flightNumbers).not.toContain("AT999");
  });

  it("never leaks user A's flights into user B's evidence for the same aircraft type", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/aircraftType:A320neo")
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    // User B's own single A320neo flight is legitimately theirs...
    expect(res.body.measure.value).toBe(1);
    // ...but neither of user A's A320neo flight ids appear here.
    const flightsA = await prisma.flight.findMany({
      where: { userId: userAId, flightNumber: { in: ["AT100", "AT101"] } },
      select: { id: true },
    });
    const returnedIds = res.body.entries.map((e: { id: string }) => e.id);
    for (const f of flightsA) expect(returnedIds).not.toContain(f.id);
  });

  it("answers 200 with value 0, not 404, for a real aircraft spelling this user never flew", async () => {
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/${encodeURIComponent("aircraftType:Boeing 787-9")}`)
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it("answers 400, not 404, for a scope this ranking does not measure", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/aircraftType:A320neo?period=year&year=2025")
      .set("Cookie", userACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period=allTime/);
  });
});

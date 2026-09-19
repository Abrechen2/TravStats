import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * The first real resolver, and the hardest identity in the feature
 * (`.superpowers/sdd/2026-09-18-evidence-panel/task-5-brief.md`):
 * `GET /stats/airlines` (`routes/stats.ts`) is a Prisma
 * `groupBy(["airline", "airlineIata", "airlineIcao"])` whose rows are then
 * FOLDED by `groupAirlines`, so one ranking row can cover several stored
 * spellings — evidence has to select exactly the flights that fold into the
 * requested row, not the flights whose `airline` column happens to match a
 * label. Each test below names the way a naive `where: { airline: label }`
 * implementation would get this wrong.
 */
describe("GET /api/v1/evidence/ranking/airline:... — the airline resolver", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;

  interface FlightFixtureOverrides {
    airline?: string | null;
    airlineIata?: string | null;
    airlineIcao?: string | null;
    flightNumber?: string;
    departureTime?: Date;
    status?: string;
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
      where: { username: { in: ["evidencerankingA", "evidencerankingB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidencerankingA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidencerankingB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        // Carries the CODE but no name — exactly how a boarding-pass import
        // stores a carrier. `where: { airline: "Lufthansa" }` would miss it;
        // `airlineGroupKey` still resolves it to `iata:LH`.
        flightFixture(userAId, {
          airline: null,
          airlineIata: "LH",
          flightNumber: "LH400",
          departureTime: new Date("2025-01-10T08:00:00Z"),
        }),
        flightFixture(userAId, {
          airline: "Lufthansa",
          flightNumber: "LH401",
          departureTime: new Date("2025-02-10T08:00:00Z"),
        }),
        flightFixture(userAId, {
          airline: "Lufthansa",
          flightNumber: "LH402",
          departureTime: new Date("2025-03-10T08:00:00Z"),
        }),
        // No airline identity at all — its group key is `null`, which can
        // never equal a target key of the shape `iata:...`/`name:...`. A
        // filter that treated a null key as a wildcard match would leak
        // this into every row's evidence.
        flightFixture(userAId, {
          airline: null,
          airlineIata: null,
          airlineIcao: null,
          flightNumber: "NOCARRIER1",
        }),
        // Same identity as the first flight, but `countableFlightWhere()`
        // excludes it — a resolver that filtered by identity alone, without
        // the same status filter the ranking uses, would still show it.
        flightFixture(userAId, {
          airline: null,
          airlineIata: "LH",
          flightNumber: "LH999",
          status: "cancelled",
        }),
      ],
    });

    // User B's own, unrelated Lufthansa flight — proves the cross-user
    // probe below isn't merely observing an empty result for the wrong
    // reason (no Lufthansa flights exist at all).
    await prisma.flight.create({
      data: flightFixture(userBId, { airline: "Lufthansa", flightNumber: "LH500" }),
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  async function lufthansaRankingRow(cookie: string) {
    const res = await request(app).get("/api/v1/stats/airlines").set("Cookie", cookie);
    const row = res.body.airlines.find((a: { airline: string }) => a.airline === "Lufthansa");
    expect(row).toBeDefined();
    return row as { airline: string; count: number; key: string; iata?: string };
  }

  it("credits a flight with airline: null but airlineIata: 'LH' to Lufthansa's evidence", async () => {
    const row = await lufthansaRankingRow(userACookie);
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/airline:${row.key}`)
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toContain("LH400");
  });

  it("never puts a flight with no airline identity at all into a named row", async () => {
    const row = await lufthansaRankingRow(userACookie);
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/airline:${row.key}`)
      .set("Cookie", userACookie);

    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("NOCARRIER1");
    // It belongs to `withoutAirline` on the ranking itself, not to a row.
    const rankingRes = await request(app).get("/api/v1/stats/airlines").set("Cookie", userACookie);
    expect(rankingRes.body.flightsWithoutAirline).toBeGreaterThanOrEqual(1);
  });

  it("excludes a flight `countableFlightWhere()` excludes, even though its identity matches", async () => {
    const row = await lufthansaRankingRow(userACookie);
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/airline:${row.key}`)
      .set("Cookie", userACookie);

    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("LH999");
    // Three countable Lufthansa flights (LH400/401/402) — the cancelled
    // LH999 must not have quietly become a fourth.
    expect(res.body.measure.value).toBe(3);
  });

  it("holds the sum invariant against the ranking row's own count, for the top row of the seeded account", async () => {
    const row = await lufthansaRankingRow(userACookie);
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/airline:${row.key}`)
      .set("Cookie", userACookie);

    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(row.count);
    assertSumInvariant(res.body, Math.round);
  });

  it("never leaks user A's flights into user B's evidence for the same key", async () => {
    const row = await lufthansaRankingRow(userACookie);
    const res = await request(app)
      .get(`/api/v1/evidence/ranking/airline:${row.key}`)
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    // User B's own single Lufthansa flight is legitimately theirs...
    expect(res.body.measure.value).toBe(1);
    // ...but none of user A's three Lufthansa flight ids appear here.
    const flightsA = await prisma.flight.findMany({
      where: { userId: userAId, flightNumber: { in: ["LH400", "LH401", "LH402"] } },
      select: { id: true },
    });
    const returnedIds = res.body.entries.map((e: { id: string }) => e.id);
    for (const f of flightsA) expect(returnedIds).not.toContain(f.id);
  });

  it("answers 200 with value 0, not 404, for a valid key this user simply has no flights on", async () => {
    // SWISS (`iata:LX`) is a real, catalogue-resolvable carrier that neither
    // seeded user has flown — the key names a real row, the data just isn't
    // there for this user. A 404 here would say the row doesn't exist, which
    // is the wrong reason: it exists, it's just empty (spec, "the key
    // exists; the data does not").
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airline:iata:LX")
      .set("Cookie", userBCookie);

    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it("answers 400, not 404, for a scope this ranking does not measure", async () => {
    // `/stats/airlines` measures all-time unconditionally, so `period=year`
    // asks for a population the tile never shows. The key itself is real
    // (`iata:LH` exists as a row) — the request is what's wrong, so this
    // must be 400, the same class of answer the stray-`year` cases already
    // get. Before this ruling the resolver returned `null` here, which the
    // dispatcher turns into 404 — this test fails against that behaviour.
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airline:iata:LH?period=year&year=2025")
      .set("Cookie", userACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period=allTime/);
  });
});

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { calculateDistance } from "../../utils/geo";
import {
  assertSumInvariant,
  assertDistinctInvariant,
} from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence, flight-core allTime family (task-7-brief.md):
 * `flightCount`, `flightTimeMinutes`, `distanceKmTotal`, `airlineCount`,
 * `flightsWithoutAirlineCount`, `businessTotalCost`, `punctualitySampleSize`.
 * All seven share one fixture set — every countable flight participates in
 * every measure, unlike a ranking key which only concerns one row.
 */
describe("GET /api/v1/evidence/metric/... — the flight-core allTime family", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;
  let userCId: string;
  let userCCookie: string;

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
    await prisma.user.deleteMany({
      where: {
        username: { in: ["evidencemetriccoreA", "evidencemetriccoreB", "evidencemetriccoreC"] },
      },
    });
    const [userA, userB, userC] = await Promise.all([
      prisma.user.create({
        data: {
          username: "evidencemetriccoreA",
          passwordHash: await hashPassword("password123"),
        },
      }),
      prisma.user.create({
        data: {
          username: "evidencemetriccoreB",
          passwordHash: await hashPassword("password123"),
        },
      }),
      prisma.user.create({
        data: {
          username: "evidencemetriccoreC",
          passwordHash: await hashPassword("password123"),
        },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userCId = userC.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;
    userCCookie = `auth_token=${generateToken(userC.id)}`;

    await prisma.flight.createMany({
      data: [
        // Carries the CODE but no name — folds into the LH group.
        flightFixture(userAId, "2025-01-10", {
          airline: null,
          airlineIata: "LH",
          flightNumber: "MC100",
          delayMinutes: 10,
        }),
        // Carries the NAME, no code — same carrier, via the catalogue, so
        // this is the SAME group as MC100, not a second airline.
        flightFixture(userAId, "2025-02-10", {
          airline: "Lufthansa",
          flightNumber: "MC101",
          price: 100,
          currency: "EUR",
        }),
        // No airline identity at all — excluded from every airline group,
        // and exactly the population `flightsWithoutAirlineCount` counts.
        flightFixture(userAId, "2025-03-10", {
          airline: null,
          airlineIata: null,
          airlineIcao: null,
          flightNumber: "MC102",
        }),
        // A second, distinct airline.
        flightFixture(userAId, "2025-04-10", {
          airline: "British Airways",
          airlineIata: "BA",
          flightNumber: "MC103",
          delayMinutes: 5,
          price: 50,
          currency: "EUR",
        }),
        // Touches everything the others do, but `countableFlightWhere()`
        // excludes it — must not leak into any of the seven totals.
        flightFixture(userAId, "2025-05-10", {
          airline: "Lufthansa",
          flightNumber: "MC999",
          status: "cancelled",
          delayMinutes: 999,
          price: 200,
          currency: "EUR",
        }),
      ],
    });

    // User B's own, unrelated flight — the cross-user probe below.
    await prisma.flight.create({
      data: flightFixture(userBId, "2025-01-15", {
        airline: "Lufthansa",
        flightNumber: "BC100",
        price: 10,
        currency: "EUR",
        delayMinutes: 1,
      }),
    });

    // User C: ONE flight, priced in a currency that is not the base one and
    // carrying no FX snapshot (`priceBase`/`fxBaseCurrency` null, which is
    // every row written before #267). Nothing this account owns can reach
    // EUR, so `businessTotalCost` has no honest answer to give.
    await prisma.flight.create({
      data: flightFixture(userCId, "2025-02-20", {
        airline: "Emirates",
        flightNumber: "CC100",
        price: 11662,
        currency: "AED",
      }),
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId, userCId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId, userCId] } } });
  });

  it("flightCount: counts the four countable flights, excluding the cancelled one", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flightCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(4);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).not.toContain("MC999");
    assertSumInvariant(res.body, Math.round);
  });

  it("flightCount: never leaks user A's flights into user B's own count", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flightCount")
      .set("Cookie", userBCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
  });

  it("distanceKmTotal: sums the great-circle distance of every countable flight", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/distanceKmTotal")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(Math.round(singleLegDistanceKm * 4));
    assertSumInvariant(res.body, Math.round);
  });

  it("flightTimeMinutes: sums the measured 90-minute duration of every countable flight", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flightTimeMinutes")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(90 * 4);
    assertSumInvariant(res.body, Math.round);
  });

  it("airlineCount: folds the airlineIata-only row and the name-only row into ONE distinct airline", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/airlineCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    // LH (MC100 + MC101) + BA (MC103) = 2 distinct airlines; MC102 credits none.
    expect(res.body.measure.value).toBe(2);
    assertDistinctInvariant(res.body);
  });

  it("flightsWithoutAirlineCount: counts exactly the flight with no airline identity at all", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flightsWithoutAirlineCount")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toEqual(["MC102"]);
    assertSumInvariant(res.body, Math.round);
  });

  it("businessTotalCost: dedupes nothing here (no shared booking) and sums the two priced flights, skipping the cancelled one", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/businessTotalCost")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(150);
    assertSumInvariant(res.body, (n: number) => Math.round(n * 100) / 100);
  });

  /**
   * The drift guard `metricEvidenceFlightCore.ts` promises. `dedupedCost.ts`
   * and `businessStats.ts` are two hand-kept copies of one rule, so the
   * literal above proves only that the resolver agrees with itself — the sum
   * invariant cannot help either, since `value` and `omitted.contribution`
   * come from the same total. What catches a divergence between the two
   * copies is asking the TILE'S OWN endpoint, in the same test, what number
   * it renders.
   */
  it("businessTotalCost: answers the same total /stats/business renders", async () => {
    const [evidence, business] = await Promise.all([
      request(app).get("/api/v1/evidence/metric/businessTotalCost").set("Cookie", userACookie),
      request(app).get("/api/v1/stats/business").set("Cookie", userACookie),
    ]);
    expect(evidence.status).toBe(200);
    expect(business.status).toBe(200);
    expect(evidence.body.measure.value).toBe(business.body.totalCost);
  });

  /**
   * The abstention branch, against the REAL resolver rather than an injected
   * fake. `value: null` means "cannot be derived" and must never be drawn as
   * 0 — 11,662 AED is not €11,662, which is a mistake this codebase has made
   * once already (`dedupedCost.ts`'s own note). The contract also requires a
   * REASON whenever the value is null, which is what `assertSumInvariant`'s
   * `requireReasonForNull` checks here.
   */
  it("businessTotalCost: answers null, with a reason, when no amount can reach the base currency", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/businessTotalCost")
      .set("Cookie", userCCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBeNull();
    expect(res.body.unattributed).toEqual([{ count: 1, reason: "notPerEntry" }]);
    // The row is still shown: "we cannot total this" is not "we have nothing".
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers).toEqual(["CC100"]);
    assertSumInvariant(res.body, (n: number) => Math.round(n * 100) / 100);
  });

  it("punctualitySampleSize: samples only the countable flights carrying a recorded delay", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/punctualitySampleSize")
      .set("Cookie", userACookie);
    expect(res.status).toBe(200);
    // MC100 (delay 10) + MC103 (delay 5) = 2; MC999's delay is real but the
    // flight is cancelled, so `countableFlightWhere()` excludes it first.
    expect(res.body.measure.value).toBe(2);
    const flightNumbers = res.body.entries.map((e: { title: { text: string } }) => e.title.text);
    expect(flightNumbers.sort()).toEqual(["MC100", "MC103"]);
    assertSumInvariant(res.body, Math.round);
  });

  it("answers 400, not 404, for a scope none of these seven measure", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flightCount?period=year&year=2025")
      .set("Cookie", userACookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period=allTime/);
  });

  it("answers 404 for a metric key this instance does not serve in release 1", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/avgFlightDurationMinutes")
      .set("Cookie", userACookie);
    expect(res.status).toBe(404);
  });
});

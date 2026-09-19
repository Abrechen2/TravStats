import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The defect this test file exists to close: `tripDominantCost` (frontend)
 * picked each trip's largest PER-CURRENCY bucket and then compared those raw
 * numbers across trips — so a 200.000 KRW trip (≈130 €, face value 200.000)
 * beat a 1.650 € trip on the trips page. `services/trip/tripCostSuperlative.ts`
 * fixes this by ranking on the FX base-currency amount, computed over EVERY
 * trip the user has (not the capped `GET /trips` list).
 *
 * Fixtures write `priceBase`/`fxBaseCurrency` directly via Prisma rather than
 * going through the write paths (already covered by
 * `cruises.fxSnapshot.test.ts` and the flight/lodging equivalents) — this
 * file is only about the RANKING once those columns exist.
 */
describe("GET /trips?includeInsights=true — the most expensive trip", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mostExpensiveTripTest" } });
    const user = await prisma.user.create({
      data: { username: "mostExpensiveTripTest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("is absent from the response unless explicitly requested", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.mostExpensiveTrip).toBeUndefined();
  });

  it("a large-face-value foreign currency does not beat a small-face-value euro trip", async () => {
    const krwTrip = await prisma.trip.create({
      data: { userId, name: "Seoul", status: "completed" },
    });
    await prisma.booking.create({
      data: {
        userId,
        tripId: krwTrip.id,
        price: 200000,
        currency: "KRW",
        // ~130 EUR — the real ECB rate at the time this fixture was written.
        priceBase: 130,
        fxRate: 0.00065,
        fxRateDate: new Date("2026-01-01"),
        fxBaseCurrency: "EUR",
      },
    });

    const eurTrip = await prisma.trip.create({
      data: { userId, name: "Weekend in Paris", status: "completed" },
    });
    await prisma.booking.create({
      data: {
        userId,
        tripId: eurTrip.id,
        price: 1650,
        currency: "EUR",
        priceBase: 1650,
        fxRate: 1,
        fxRateDate: new Date("2026-01-01"),
        fxBaseCurrency: "EUR",
      },
    });

    const res = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.mostExpensiveTrip).toMatchObject({
      tripId: eurTrip.id,
      name: "Weekend in Paris",
      amount: 1650,
      currency: "EUR",
    });
  });

  it("leaves a trip with an unconvertible cost item out of the comparison, and counts it as excluded", async () => {
    const unconvertible = await prisma.trip.create({
      data: { userId, name: "No rate on file", status: "completed" },
    });
    // A cost item with a price but NO fx snapshot — e.g. a currency the ECB
    // does not cover and no manual rate was ever supplied.
    await prisma.booking.create({
      data: { userId, tripId: unconvertible.id, price: 999999, currency: "XYZ" },
    });

    const res = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    // Still the euro trip from the previous test's fixtures — the
    // unconvertible one, despite the largest RAW number of all, never enters
    // the comparison.
    expect(res.body.mostExpensiveTrip.tripId).not.toBe(unconvertible.id);
    expect(res.body.mostExpensiveTrip.excluded).toEqual({
      count: 1,
      reason: "unconvertible",
    });
  });

  it("ignores a planned trip even if it would otherwise win", async () => {
    const planned = await prisma.trip.create({
      data: { userId, name: "Someday", status: "planned" },
    });
    await prisma.booking.create({
      data: {
        userId,
        tripId: planned.id,
        price: 999999,
        currency: "EUR",
        priceBase: 999999,
        fxRate: 1,
        fxRateDate: new Date("2026-01-01"),
        fxBaseCurrency: "EUR",
      },
    });

    const res = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.mostExpensiveTrip.tripId).not.toBe(planned.id);
  });
});

/**
 * Fix round 1, finding 1 (High): `costItemsForTrip` summed `priceBase` across
 * a trip's items without checking `fxBaseCurrency` — a user who moved their
 * base currency from EUR to USD has OLDER snapshots stamped `fxBaseCurrency:
 * "EUR"` and newer ones stamped `"USD"`, and the old code added them, which
 * is the exact defect this whole file exists to fix, one level down.
 *
 * A dedicated user + describe block: the base currency is account-wide
 * (`UserSettings.baseCurrency`), so this cannot share a fixture user with the
 * tests above without changing what "the current base currency" means for
 * them too.
 */
describe("GET /trips?includeInsights=true — a stale base-currency snapshot", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "staleBaseCurrencyTest" } });
    const user = await prisma.user.create({
      data: { username: "staleBaseCurrencyTest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    // The account's CURRENT base currency is USD.
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "USD" } });
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("excludes a trip snapshotted under a base currency the account has since moved away from", async () => {
    // Snapshotted back when the account's base currency was still EUR — a
    // real, non-null priceBase, just in the WRONG base currency now.
    const staleTrip = await prisma.trip.create({
      data: { userId, name: "Snapshotted under the old base", status: "completed" },
    });
    await prisma.booking.create({
      data: {
        userId,
        tripId: staleTrip.id,
        price: 1000,
        currency: "GBP",
        priceBase: 1150, // GBP -> EUR, back when EUR was the base
        fxRate: 1.15,
        fxRateDate: new Date("2025-01-01"),
        fxBaseCurrency: "EUR",
      },
    });

    // A smaller RAW number, but snapshotted in the CURRENT base currency
    // (USD) — this must win, because it is the only convertible trip.
    const currentTrip = await prisma.trip.create({
      data: { userId, name: "Snapshotted under the current base", status: "completed" },
    });
    await prisma.booking.create({
      data: {
        userId,
        tripId: currentTrip.id,
        price: 500,
        currency: "USD",
        priceBase: 500,
        fxRate: 1,
        fxRateDate: new Date("2026-01-01"),
        fxBaseCurrency: "USD",
      },
    });

    const res = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.mostExpensiveTrip).toMatchObject({
      tripId: currentTrip.id,
      name: "Snapshotted under the current base",
    });
    expect(res.body.mostExpensiveTrip.excluded).toEqual({
      count: 1,
      reason: "unconvertible",
    });
  });
});

/**
 * A cost item already priced IN the base currency needs no FX snapshot.
 *
 * Every trip whose costs were entered before the snapshot columns existed
 * carries `priceBase: null` on at least one item, and `costItemsForTrip` used
 * to downgrade that to unconvertible — which puts the WHOLE trip into
 * `excluded` and can leave the superlative with nothing to name at all. Same
 * defect class the cruise money tile drew as a dash on 2026-09-19: a
 * derivation that insists on a new column treats every pre-existing row as
 * worthless.
 *
 * Its own user, for the reason the block above gives: the base currency is
 * account-wide, so these fixtures cannot share one.
 */
describe("GET /trips?includeInsights=true — a cost item already in the base currency", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "baseCurrencyNoSnapshotTest" } });
    const user = await prisma.user.create({
      data: {
        username: "baseCurrencyNoSnapshotTest",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("ranks a trip whose euro costs predate the snapshot columns", async () => {
    const preSnapshot = await prisma.trip.create({
      data: { userId, name: "Entered before the FX columns", status: "completed" },
    });
    await prisma.booking.create({
      data: { userId, tripId: preSnapshot.id, price: 2000, currency: "EUR" },
    });

    // The shortcut is about the currency the price is IN, not about the
    // absence of a snapshot: a dollar price with no rate stays unconvertible.
    const foreign = await prisma.trip.create({
      data: { userId, name: "Dollars, no rate on file", status: "completed" },
    });
    await prisma.booking.create({
      data: { userId, tripId: foreign.id, price: 5000, currency: "USD" },
    });

    const res = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.mostExpensiveTrip).toMatchObject({
      tripId: preSnapshot.id,
      name: "Entered before the FX columns",
      amount: 2000,
      currency: "EUR",
    });
    expect(res.body.mostExpensiveTrip.excluded).toEqual({ count: 1, reason: "unconvertible" });
  });

  it("adds a snapshot-less euro item to a foreign one that does carry a snapshot", async () => {
    const mixed = await prisma.trip.create({
      data: { userId, name: "One of each", status: "completed" },
    });
    await prisma.booking.create({
      data: { userId, tripId: mixed.id, price: 1000, currency: "EUR" },
    });
    await prisma.booking.create({
      data: {
        userId,
        tripId: mixed.id,
        price: 1200,
        currency: "USD",
        priceBase: 1100,
        fxRate: 0.9167,
        fxRateDate: new Date("2026-01-01"),
        fxBaseCurrency: "EUR",
      },
    });

    const res = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    // 1000 + 1100 = 2100 base, beating the 2000 trip above. The DISPLAYED
    // figure stays the dominant per-currency bucket, which is the dollars.
    expect(res.body.mostExpensiveTrip).toMatchObject({
      tripId: mixed.id,
      amount: 1200,
      currency: "USD",
    });
    expect(res.body.mostExpensiveTrip.excluded).toEqual({ count: 1, reason: "unconvertible" });
  });
});

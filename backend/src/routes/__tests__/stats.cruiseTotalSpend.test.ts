import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `totalSpendBase` on `GET /stats/cruise` — the cruise tab's one money figure
 * that is a single number.
 *
 * `evidence.metricCruise.test.ts` holds the tile and the evidence panel
 * together on a fixture where something DOES convert. This suite covers the
 * two cases that fixture cannot show at once: a stale base currency, and a
 * scope in which nothing converts at all.
 *
 * The stale case is the one worth stating. `priceBase` is a snapshot taken in
 * the base currency of the day; when the account later moves to another base
 * currency the stored number stays real but stops being an amount THIS sum
 * speaks, so it is excluded rather than added. A test that only ever used a
 * null `priceBase` would pass with the currency comparison deleted.
 */
describe("GET /api/v1/stats/cruise — totalSpendBase", () => {
  let userId: string;
  let cookie: string;

  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  interface SpendBase {
    value: number | null;
    excludedCount: number;
    currency: string;
  }

  const fetchSpend = async (): Promise<SpendBase> => {
    const res = await request(app).get("/api/v1/stats/cruise").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.totalSpendBase as SpendBase;
  };

  /** What the evidence panel answers for the same key, on the same rows. */
  const fetchEvidence = async (): Promise<{
    value: number | null;
    unattributed: Array<{ count: number; reason: string }>;
  }> => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/cruiseTotalSpend")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    return { value: res.body.measure.value, unattributed: res.body.unattributed };
  };

  const addCruise = async (data: {
    routeName: string;
    price: number | null;
    currency: string | null;
    priceBase?: number | null;
    fxBaseCurrency?: string | null;
  }): Promise<void> => {
    await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: data.routeName,
        price: data.price,
        currency: data.currency,
        priceBase: data.priceBase ?? null,
        fxBaseCurrency: data.fxBaseCurrency ?? null,
        startDate: day("2024-05-01"),
        endDate: day("2024-05-08"),
      },
    });
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "cruisespendbase" } });
    const user = await prisma.user.create({
      data: { username: "cruisespendbase", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
  });

  afterEach(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("adds the snapshots taken in the base currency and counts the rest out", async () => {
    await addCruise({
      routeName: "Ostsee",
      price: 1200,
      currency: "EUR",
      priceBase: 1200,
      fxBaseCurrency: "EUR",
    });
    await addCruise({
      routeName: "Karibik",
      price: 900,
      currency: "USD",
      priceBase: 830.5,
      fxBaseCurrency: "EUR",
    });
    // Real money, no rate: excluded and named, never guessed at.
    await addCruise({ routeName: "Adria", price: 700, currency: "CHF" });

    const spend = await fetchSpend();
    expect(spend).toEqual({ value: 2030.5, excludedCount: 1, currency: "EUR" });
    expect((await fetchEvidence()).value).toBe(2030.5);
  });

  it("excludes a snapshot taken in a base currency the account has left", async () => {
    await addCruise({
      routeName: "Nordkap",
      price: 1000,
      currency: "EUR",
      priceBase: 1000,
      fxBaseCurrency: "EUR",
    });
    await addCruise({
      routeName: "Alaska",
      price: 2000,
      currency: "USD",
      // A snapshot in CHF: a real number, in a currency this sum does not
      // speak. Adding it would be #267 one level down.
      priceBase: 1850,
      fxBaseCurrency: "CHF",
    });

    expect(await fetchSpend()).toEqual({ value: 1000, excludedCount: 1, currency: "EUR" });
  });

  it("abstains rather than reporting a total of nothing, and agrees with the panel", async () => {
    await addCruise({ routeName: "Mittelmeer", price: 800, currency: "USD" });
    await addCruise({ routeName: "Kanaren", price: 600, currency: "USD" });

    const spend = await fetchSpend();
    expect(spend).toEqual({ value: null, excludedCount: 2, currency: "EUR" });

    // Every scoped cruise is priced here, so the panel's wider bucket — which
    // also counts cruises with no price at all — lands on the same two.
    const evidence = await fetchEvidence();
    expect(evidence.value).toBeNull();
    expect(evidence.unattributed).toEqual([{ count: 2, reason: "notPerEntry" }]);
  });

  it("answers 0 for an account with no cruise, which is not an abstention", async () => {
    expect(await fetchSpend()).toEqual({ value: 0, excludedCount: 0, currency: "EUR" });
  });

  it("does not count a cruise that has not sailed", async () => {
    await addCruise({
      routeName: "Gefahren",
      price: 500,
      currency: "EUR",
      priceBase: 500,
      fxBaseCurrency: "EUR",
    });
    await prisma.cruise.create({
      data: {
        userId,
        status: "scheduled",
        routeName: "Erst gebucht",
        price: 9000,
        currency: "EUR",
        priceBase: 9000,
        fxBaseCurrency: "EUR",
        startDate: day("2027-06-01"),
        endDate: day("2027-06-08"),
      },
    });

    expect((await fetchSpend()).value).toBe(500);
  });

  it("narrows to the year the cruise started in", async () => {
    await addCruise({
      routeName: "2024er",
      price: 400,
      currency: "EUR",
      priceBase: 400,
      fxBaseCurrency: "EUR",
    });
    await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: "2023er",
        price: 300,
        currency: "EUR",
        priceBase: 300,
        fxBaseCurrency: "EUR",
        startDate: day("2023-05-01"),
        endDate: day("2023-05-08"),
      },
    });

    const res = await request(app)
      .get("/api/v1/stats/cruise")
      .query({ year: 2024 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalSpendBase.value).toBe(400);
  });
});

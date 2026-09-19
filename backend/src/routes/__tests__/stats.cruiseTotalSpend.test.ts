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

  interface EvidenceEntry {
    id: string;
    contribution: number;
    subtitle: { key: string; values?: Record<string, unknown> } | null;
  }

  /** What the evidence panel answers for the same key, on the same rows. */
  const fetchEvidence = async (): Promise<{
    value: number | null;
    unattributed: Array<{ count: number; reason: string }>;
    entries: EvidenceEntry[];
  }> => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/cruiseTotalSpend")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    return {
      value: res.body.measure.value,
      unattributed: res.body.unattributed,
      entries: res.body.entries as EvidenceEntry[],
    };
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

  /**
   * The case the beta drew a dash for on 2026-09-19: every cruise priced in
   * the account's own currency, none of them carrying a snapshot, because they
   * were written before the column existed. If this passes only on rows some
   * backfill has touched, the figure is not a figure.
   */
  it("counts a cruise priced in the base currency although it has no snapshot", async () => {
    await addCruise({ routeName: "Ostsee ohne Kurs", price: 1200, currency: "EUR" });
    await addCruise({ routeName: "Norwegen ohne Kurs", price: 800, currency: "EUR" });

    expect(await fetchSpend()).toEqual({ value: 2000, excludedCount: 0, currency: "EUR" });

    // The panel reads the same predicate, so neither cruise may be listed as
    // unconverted — the tile's zero exclusions and the panel's row list are
    // the same sentence told twice.
    const evidence = await fetchEvidence();
    expect(evidence.value).toBe(2000);
    expect(evidence.entries.map((e) => e.contribution).sort((a, b) => a - b)).toEqual([800, 1200]);
    expect(evidence.entries.filter((e) => e.subtitle !== null)).toEqual([]);
  });

  /**
   * The other half of the shortcut: it applies to the currency the price is
   * IN, never to the absence of a snapshot as such. A dollar price with no
   * rate is still money this sum cannot speak.
   */
  it("still excludes a foreign-currency cruise that has no snapshot", async () => {
    await addCruise({ routeName: "Heimisch", price: 500, currency: "EUR" });
    await addCruise({ routeName: "Karibik ohne Kurs", price: 900, currency: "USD" });

    expect(await fetchSpend()).toEqual({ value: 500, excludedCount: 1, currency: "EUR" });

    const evidence = await fetchEvidence();
    const unconverted = evidence.entries.filter((e) => e.subtitle !== null);
    expect(unconverted).toHaveLength(1);
    expect(unconverted[0].subtitle).toEqual({
      key: "evidence.subtitle.notConverted",
      values: { amount: 900, currency: "USD" },
    });
  });

  /** A foreign price still needs its snapshot, and is counted AT it. */
  it("counts a foreign-currency cruise at its snapshot, not at its price", async () => {
    await addCruise({
      routeName: "Karibik",
      price: 900,
      currency: "USD",
      priceBase: 830.5,
      fxBaseCurrency: "EUR",
    });

    expect(await fetchSpend()).toEqual({ value: 830.5, excludedCount: 0, currency: "EUR" });
  });

  /**
   * Price beats snapshot where the price is already home.
   *
   * An account that moved its base currency to USD and back to EUR carries
   * EUR cruises whose snapshot reads USD. The snapshot is the stale reading
   * there; the price is not, and reaching for the snapshot first would exclude
   * a cruise denominated in the very currency being summed.
   */
  it("counts a base-currency cruise at its own price although the snapshot is stale", async () => {
    await addCruise({
      routeName: "Hin und zurueck",
      price: 1000,
      currency: "EUR",
      priceBase: 1080,
      fxBaseCurrency: "USD",
    });

    expect(await fetchSpend()).toEqual({ value: 1000, excludedCount: 0, currency: "EUR" });
    expect((await fetchEvidence()).value).toBe(1000);
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

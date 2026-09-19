import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence for the ten served lodging-tab measures
 * (task-7b-3-brief.md).
 *
 * The cross-check at the bottom fetches `GET /stats/lodging` — the endpoint
 * the tab renders — in the same run. As with the cruise family it is an
 * ARGUMENT guard rather than a population guard: both sides call the same
 * `loadLodgingStatsData` and the same `calculateLodgingStats`, so a wrong
 * population moves the two numbers together. What the per-key literals below
 * carry is the SPLIT — which stay contributed what — and each of them
 * therefore names a stay rather than a number.
 *
 * The fixture, all of it user A's, all 2024 unless stated:
 *   - Hotel Rheinblick, Germany, 10–13 March: three nights, 300 EUR with a
 *     EUR snapshot, four ratings of 5.
 *   - Hotel Rheinblick again, 20–21 March: ONE night, an award stay, no
 *     price. The same house twice.
 *   - Sakura Inn, Japan, 1–3 May: two nights, 40000 JPY with NO snapshot —
 *     real money nothing can convert. Rated 5 overall and blank elsewhere,
 *     so NOT a perfect stay.
 *   - Casa Verde, Spain, MONTH precision, two nights stated and no days
 *     named: it counts nights and marks no calendar day.
 *   - Hotel Morgen, a booking for 2027 that has not happened yet.
 *   - Berghütte, a house marked visited with no stay at all.
 */
describe("GET /api/v1/evidence/metric/... — the lodging tab", () => {
  let userId: string;
  let cookie: string;
  let rheinblickId: string;
  let sakuraId: string;
  let casaId: string;
  let huetteId: string;
  let morgenId: string;
  let stayMarchLong: string;
  let stayMarchAward: string;
  let staySakura: string;
  let stayCasa: string;

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      domain: string;
      href: string | null;
      credits?: string[];
      creditLabels?: Record<string, string>;
      contribution?: number;
      subtitle?: { key: string; values?: Record<string, string | number> } | null;
    }>;
    omitted: { count: number; contribution?: number; credits?: number };
    unattributed: Array<{ count: number; reason: string }>;
  }

  const KEYS = [
    "lodgingStaysCount",
    "lodgingNightsTotal",
    "lodgingSpendTotal",
    "lodgingAwardNightsCount",
    "lodgingNightsAwayTotal",
    "lodgingOneNightStayCount",
    "lodgingPerfectStayCount",
    "lodgingsUniqueCount",
    "lodgingCountriesCount",
    "lodgingContinentsCount",
  ] as const;

  const lifetime = new Map<string, EvidenceBody>();
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
  const answer = (key: (typeof KEYS)[number]): EvidenceBody => lifetime.get(key)!;
  const entry = (key: (typeof KEYS)[number], id: string): EvidenceBody["entries"][number] =>
    answer(key).entries.find((e) => e.id === id)!;

  /**
   * The figures `/stats/lodging` renders, for the cross-check. Only the ten
   * this suite compares against are declared — a wider shape would be a second
   * copy of that response's contract kept in a test.
   */
  interface LodgingTabStats {
    staysCount: number;
    totalNights: number;
    spendBaseTotal: number;
    awardNights: number;
    oneNightStays: number;
    perfectStays: number;
    lodgingsCount: number;
    countriesCount: number;
    rhythm: { nightsAway: number };
    geo: { continentsCount: number };
  }
  let tabStats: LodgingTabStats;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencelodging" } });
    const user = await prisma.user.create({
      data: { username: "evidencelodging", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const [rheinblick, sakura, casa, huette, morgen] = await Promise.all([
      prisma.lodging.create({
        data: {
          userId,
          name: "Hotel Rheinblick",
          type: "hotel",
          country: "Germany",
          isoCountryCode: "DE",
          city: "Köln",
          lat: 50.9375,
          lon: 6.9603,
          visited: true,
        },
      }),
      prisma.lodging.create({
        data: {
          userId,
          name: "Sakura Inn",
          type: "hotel",
          country: "Japan",
          isoCountryCode: "JP",
          city: "Kyoto",
          lat: 35.0116,
          lon: 135.7681,
          visited: true,
        },
      }),
      prisma.lodging.create({
        data: {
          userId,
          name: "Casa Verde",
          type: "apartment",
          country: "Spain",
          isoCountryCode: "ES",
          city: "Valencia",
          lat: 39.4699,
          lon: -0.3763,
          visited: true,
        },
      }),
      prisma.lodging.create({
        data: {
          userId,
          name: "Berghütte",
          type: "other",
          country: "Austria",
          isoCountryCode: "AT",
          city: "Innsbruck",
          lat: 47.2692,
          lon: 11.4041,
          visited: true,
        },
      }),
      prisma.lodging.create({
        data: {
          userId,
          name: "Hotel Morgen",
          type: "hotel",
          country: "Iceland",
          isoCountryCode: "IS",
          city: "Reykjavík",
          lat: 64.1466,
          lon: -21.9426,
          visited: true,
        },
      }),
    ]);
    rheinblickId = rheinblick.id;
    sakuraId = sakura.id;
    casaId = casa.id;
    huetteId = huette.id;
    morgenId = morgen.id;

    const created = await Promise.all([
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: rheinblickId,
          status: "completed",
          checkIn: day("2024-03-10"),
          checkOut: day("2024-03-13"),
          datePrecision: "DAY",
          totalPrice: 300,
          currency: "EUR",
          // NO snapshot, on purpose: this is what every stay entered before
          // the FX columns shipped looks like, and it is an amount already in
          // the account's base currency, so it needs none. Requiring one made
          // the panel list it as unconverted while the tile above it counted
          // the same 300 (`shared/lodgingSpendBase.ts`).
          totalPriceBase: null,
          fxBaseCurrency: null,
          ratingOverall: 5,
          ratingRoom: 5,
          ratingBreakfast: 5,
          ratingService: 5,
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: rheinblickId,
          status: "completed",
          checkIn: day("2024-03-20"),
          checkOut: day("2024-03-21"),
          datePrecision: "DAY",
          isAwardStay: true,
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: sakuraId,
          status: "completed",
          checkIn: day("2024-05-01"),
          checkOut: day("2024-05-03"),
          datePrecision: "DAY",
          // Priced, and nothing converted it: the amount belongs on screen and
          // in no base-currency sum.
          totalPrice: 40000,
          currency: "JPY",
          ratingOverall: 5,
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: casaId,
          status: "completed",
          // MONTH precision: the dates are placeholders spanning the month, so
          // the nights are known and the DAYS are not.
          checkIn: day("2024-07-01"),
          checkOut: day("2024-07-31"),
          datePrecision: "MONTH",
          nights: 2,
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: morgenId,
          status: "scheduled",
          checkIn: day("2027-02-01"),
          checkOut: day("2027-02-05"),
          datePrecision: "DAY",
          totalPrice: 900,
          currency: "EUR",
          totalPriceBase: 900,
          fxBaseCurrency: "EUR",
        },
      }),
    ]);
    stayMarchLong = created[0].id;
    stayMarchAward = created[1].id;
    staySakura = created[2].id;
    stayCasa = created[3].id;
    expect(huetteId).toBeTruthy();

    for (const key of KEYS) {
      const res = await request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 200]);
      lifetime.set(key, res.body as EvidenceBody);
    }

    const tab = await request(app).get("/api/v1/stats/lodging").set("Cookie", cookie);
    expect(tab.status).toBe(200);
    tabStats = tab.body.data as LodgingTabStats;
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /**
   * Four stays happened; the 2027 booking has not. The owner rule is that a
   * stay counts only once its check-out is past, so a booking is never part of
   * an actual figure.
   */
  it("lodgingStaysCount: the four that are over, not the one still ahead", () => {
    const res = answer("lodgingStaysCount");
    expect(res.measure.value).toBe(4);
    expect(res.entries.map((e) => e.id).sort()).toEqual(
      [stayMarchLong, stayMarchAward, staySakura, stayCasa].sort()
    );
    expect(res.entries.every((e) => e.domain === "lodging")).toBe(true);
    // A stay has no page of its own: the id is the STAY, the link its house.
    expect(entry("lodgingStaysCount", stayMarchLong).href).toBe(`/lodging/${rheinblickId}`);
    assertSumInvariant(res, Math.round);
  });

  /** 3 + 1 + 2 + 2. The month-precision stay's two nights count; its days do not. */
  it("lodgingNightsTotal: eight nights, including the two nobody can place", () => {
    const res = answer("lodgingNightsTotal");
    expect(res.measure.value).toBe(8);
    expect(entry("lodgingNightsTotal", stayMarchLong).contribution).toBe(3);
    expect(entry("lodgingNightsTotal", stayCasa).contribution).toBe(2);
    assertSumInvariant(res, Math.round);
  });

  /**
   * 300 EUR. The 40000 JPY has no snapshot, so it is LISTED at zero with the
   * amount in its subtitle rather than dropped — and rather than put in
   * `unattributed`, which counts units of MONEY and has no idea what 40000 JPY
   * is worth here.
   */
  it("lodgingSpendTotal: the euro stay only, with the yen one shown at zero", () => {
    const res = answer("lodgingSpendTotal");
    expect(res.measure.value).toBe(300);
    expect(res.measure.unit).toBe("currency");
    expect(entry("lodgingSpendTotal", stayMarchLong).contribution).toBe(300);
    const unconverted = entry("lodgingSpendTotal", staySakura);
    expect(unconverted.contribution).toBe(0);
    expect(unconverted.subtitle).toEqual({
      key: "evidence.subtitle.notConverted",
      values: { amount: 40000, currency: "JPY" },
    });
    // The award stay carries no price at all and was never a money question.
    expect(res.entries.find((e) => e.id === stayMarchAward)).toBeUndefined();
    assertSumInvariant(res, (n) => Math.round(n * 100) / 100);
  });

  it("lodgingAwardNightsCount: the one night slept on points", () => {
    const res = answer("lodgingAwardNightsCount");
    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => e.id)).toEqual([stayMarchAward]);
    assertSumInvariant(res, Math.round);
  });

  /**
   * Six dates, not eight. The month-precision stay has two nights and names no
   * day, which is exactly the difference between this union and
   * `lodgingNightsTotal`'s sum — and why the registry entry had to be
   * corrected from `sum` to `distinct`.
   */
  it("lodgingNightsAwayTotal: the dates that can be named, as a union", () => {
    const res = answer("lodgingNightsAwayTotal");
    expect(res.measure.aggregation).toBe("distinct");
    expect(res.measure.value).toBe(6);
    const days = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...days].sort()).toEqual([
      "2024-03-10",
      "2024-03-11",
      "2024-03-12",
      "2024-03-20",
      "2024-05-01",
      "2024-05-02",
    ]);
    expect(entry("lodgingNightsAwayTotal", stayCasa).credits).toEqual([]);
    assertDistinctInvariant(res);
  });

  it("lodgingOneNightStayCount: the award night, and only it", () => {
    const res = answer("lodgingOneNightStayCount");
    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => e.id)).toEqual([stayMarchAward]);
    assertSumInvariant(res, Math.round);
  });

  /**
   * A perfect stay is FOUR fives. The Kyoto stay is rated 5 overall and blank
   * elsewhere, which is not the same claim — a resolver reading `ratingOverall`
   * alone would say two.
   */
  it("lodgingPerfectStayCount: four fives, not one", () => {
    const res = answer("lodgingPerfectStayCount");
    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => e.id)).toEqual([stayMarchLong]);
    assertSumInvariant(res, Math.round);
  });

  /**
   * Four houses: three slept in and the Berghütte, entered by hand with no
   * stay at all — the owner's rule that somebody who took the trouble to enter
   * a house was there. Hotel Morgen is NOT among them although it too is
   * marked visited: its only stay lies ahead, and a house whose stays are all
   * still to come is `planned`, however the flag reads. The flag defaults to
   * true for everything parsed from a booking, including next year's, so the
   * flag alone cannot tell "have been" from "will be" and the dates can.
   *
   * Two stays at the Rheinblick are ONE lodging, which is what makes this
   * `distinct` and not a stay count.
   */
  it("lodgingsUniqueCount: the same hotel twice is one lodging, and a booking is no house", () => {
    const res = answer("lodgingsUniqueCount");
    expect(res.measure.value).toBe(4);
    expect(res.entries.map((e) => e.id)).not.toContain(morgenId);
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect(credited.has(rheinblickId)).toBe(true);
    expect(credited.has(huetteId)).toBe(true);
    expect(res.entries.filter((e) => e.id === rheinblickId)).toHaveLength(1);
    expect(entry("lodgingsUniqueCount", rheinblickId).href).toBe(`/lodging/${rheinblickId}`);
    assertDistinctInvariant(res);
  });

  /**
   * The credit is the house's UUID — two hotels of one name are two lodgings
   * — and a UUID is not a word. The panel read "belegt: ea41c04e-…" until
   * 2026-09-19, so every credited id carries its house name.
   */
  it("lodgingsUniqueCount: each credited id carries the house NAME", () => {
    const res = answer("lodgingsUniqueCount");
    expect(entry("lodgingsUniqueCount", rheinblickId).creditLabels).toEqual({
      [rheinblickId]: "Hotel Rheinblick",
    });
    expect(entry("lodgingsUniqueCount", huetteId).creditLabels).toEqual({
      [huetteId]: "Berghütte",
    });
    for (const e of res.entries) {
      for (const credit of e.credits ?? []) {
        expect([credit, e.creditLabels?.[credit]]).not.toEqual([credit, undefined]);
      }
    }
  });

  /** A country key is readable as it stands; labelling it would be a second opinion. */
  it("lodgingCountriesCount credits carry no label", () => {
    for (const e of answer("lodgingCountriesCount").entries) {
      expect(e.creditLabels).toBeUndefined();
    }
  });

  /**
   * DE, JP, ES, AT — the key `lodgingCountryKey` resolves, which prefers the
   * stored ISO code and falls back to the raw text only when nothing places
   * it. That fallback is why a credit here is not always a code, and why the
   * resolver mirrors the key rather than folding a second time: a bucket keyed
   * differently in the panel than on the tile is a second opinion about what a
   * country is.
   *
   * Iceland is absent for the same reason it is absent above: nobody has slept
   * there yet.
   */
  it("lodgingCountriesCount: one country per house, counted once each", () => {
    const res = answer("lodgingCountriesCount");
    // Stated as a literal as well as against the endpoint: the two sides share
    // a loader and a calculator, so a comparison alone would hold however many
    // countries both had counted.
    expect(res.measure.value).toBe(4);
    expect(res.measure.value).toBe(tabStats.countriesCount);
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...credited].sort()).toEqual(["AT", "DE", "ES", "JP"]);
    assertDistinctInvariant(res);
  });

  /** Europe and Asia. Four of the five stays are European and prove it once. */
  it("lodgingContinentsCount: two continents over four stays", () => {
    const res = answer("lodgingContinentsCount");
    expect(res.measure.value).toBe(2);
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...credited].sort()).toEqual(["Asia", "Europe"]);
    assertDistinctInvariant(res);
  });

  /** A year is a population, and the stay is filed under the year it BEGAN. */
  it("narrows to the year the stay checked in", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/lodgingNightsTotal")
      .query({ period: "year", year: 2024 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(8);

    const empty = await request(app)
      .get("/api/v1/evidence/metric/lodgingStaysCount")
      .query({ period: "year", year: 2023 })
      .set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.measure.value).toBe(0);
    expect(empty.body.entries).toEqual([]);
  });

  it("answers 400 for a rolling window the tab cannot show", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/lodgingNightsTotal")
      .query({ period: "rolling12m" })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("all ten measures equal the numbers /stats/lodging renders", () => {
    const pairs: Array<[(typeof KEYS)[number], number]> = [
      ["lodgingStaysCount", tabStats.staysCount],
      ["lodgingNightsTotal", tabStats.totalNights],
      ["lodgingSpendTotal", tabStats.spendBaseTotal],
      ["lodgingAwardNightsCount", tabStats.awardNights],
      ["lodgingNightsAwayTotal", tabStats.rhythm.nightsAway],
      ["lodgingOneNightStayCount", tabStats.oneNightStays],
      ["lodgingPerfectStayCount", tabStats.perfectStays],
      ["lodgingsUniqueCount", tabStats.lodgingsCount],
      ["lodgingCountriesCount", tabStats.countriesCount],
      ["lodgingContinentsCount", tabStats.geo.continentsCount],
    ];
    for (const [key, rendered] of pairs) {
      // The key rides in the assertion so a failure names WHICH measure
      // diverged rather than printing two bare numbers.
      expect([key, answer(key).measure.value]).toEqual([key, rendered]);
    }
  });
});

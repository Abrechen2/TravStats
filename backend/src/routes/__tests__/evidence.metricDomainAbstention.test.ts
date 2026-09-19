import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * The branches the three domain families take when a figure CANNOT be
 * derived — an account whose money nothing can convert, and a stay whose
 * length nobody recorded.
 *
 * They live in their own suite because they need a population the happy-path
 * suites deliberately do not have: `evidence.metricCruise.test.ts` and
 * `evidence.metricLodging.test.ts` each hold one convertible row, which is
 * what makes their totals real numbers, and adding an unconvertible-only
 * account to either would mean two fixtures in one file answering different
 * questions.
 *
 * "Abstention is a result" is the rule these pin (CLAUDE.md, "Practised, not
 * enforced"): a value that cannot be derived is null, never 0, and never a
 * zero dressed as a total. The panel's contract adds a second half — a null
 * value must carry a REASON — and `requireReasonForNull` in
 * `services/evidence/__tests__/invariants.ts` is what refuses the pair
 * `{value: null, unattributed: []}`.
 *
 * The fixture, all of it user A's:
 *   - NORDLICHT, sailed January 2024, priced 500 USD with NO FX snapshot.
 *     It is the account's ONLY priced cruise.
 *   - Sakura Inn, 1–3 May 2024, two nights, 40000 JPY with no snapshot.
 *   - Casa Verde, MONTH precision with no explicit night count: its nights
 *     are not 0, they are unknown, and the two are different claims.
 */
describe("GET /api/v1/evidence/metric/... — what the domain measures do when they cannot answer", () => {
  let userId: string;
  let cookie: string;
  let sakuraStay: string;
  let casaStay: string;

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      contribution?: number;
      subtitle?: { key: string; values?: Record<string, string | number> } | null;
    }>;
    omitted: { count: number; contribution?: number; credits?: number };
    unattributed: Array<{ count: number; reason: string }>;
  }

  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  const fetch = async (key: string): Promise<EvidenceBody> => {
    const res = await request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);
    expect([key, res.status]).toEqual([key, 200]);
    return res.body as EvidenceBody;
  };

  const answers = new Map<string, EvidenceBody>();

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceabstention" } });
    const user = await prisma.user.create({
      data: { username: "evidenceabstention", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: "Nordlicht",
        startDate: day("2024-01-10"),
        endDate: day("2024-01-14"),
        // Priced, and nothing converted it. The amount is real; it is real in
        // a currency this account's total is not computed in.
        price: 500,
        currency: "USD",
      },
    });

    const sakura = await prisma.lodging.create({
      data: {
        userId,
        name: "Sakura Inn",
        type: "hotel",
        country: "Japan",
        isoCountryCode: "JP",
        visited: true,
      },
    });
    const casa = await prisma.lodging.create({
      data: {
        userId,
        name: "Casa Verde",
        type: "apartment",
        country: "Spain",
        isoCountryCode: "ES",
        visited: true,
      },
    });

    const stays = await Promise.all([
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: sakura.id,
          status: "completed",
          checkIn: day("2024-05-01"),
          checkOut: day("2024-05-03"),
          datePrecision: "DAY",
          totalPrice: 40000,
          currency: "JPY",
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: casa.id,
          status: "completed",
          // MONTH precision spans the whole month as a placeholder, and no
          // explicit night count was recorded — so the length is UNKNOWN, not
          // zero. Walking the placeholders would invent 30 nights.
          checkIn: day("2024-07-01"),
          checkOut: day("2024-07-31"),
          datePrecision: "MONTH",
        },
      }),
    ]);
    sakuraStay = stays[0].id;
    casaStay = stays[1].id;

    for (const key of ["cruiseTotalSpend", "lodgingSpendTotal", "lodgingNightsTotal"]) {
      answers.set(key, await fetch(key));
    }
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /**
   * A zero here would claim the sailing was free. `CruiseMoneySection` draws
   * nothing at all in this state rather than a 0, and the panel matches it.
   */
  it("cruiseTotalSpend: abstains rather than reporting a total of nothing", () => {
    const res = answers.get("cruiseTotalSpend")!;
    expect(res.measure.value).toBeNull();
    expect(res.unattributed).toEqual([{ count: 1, reason: "notPerEntry" }]);
    // The row is still LISTED, at zero and with the amount nobody could
    // convert in its subtitle — dropping it would hide real money.
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].contribution).toBe(0);
    expect(res.entries[0].subtitle).toEqual({
      key: "evidence.subtitle.notConverted",
      values: { amount: 500, currency: "USD" },
    });
    // The pair {value: null, unattributed: []} is what this forbids.
    assertSumInvariant(res, (n) => Math.round(n * 100) / 100);
  });

  /**
   * The tile says "—" in this state (`lodgingSpendNothingConverted`), and the
   * panel says null for the same reason. The bucket counts TWO rows, not the
   * one `spendUnconvertedStays` knows about: that field counts only stays that
   * HAVE a price, and the unpriced Casa Verde gave the total nothing either.
   * A bucket that explained one row while two are missing would be a count
   * that does not add up to its own sentence.
   */
  it("lodgingSpendTotal: abstains, and the bucket counts every stay that gave nothing", () => {
    const res = answers.get("lodgingSpendTotal")!;
    expect(res.measure.value).toBeNull();
    expect(res.unattributed).toEqual([{ count: 2, reason: "notPerEntry" }]);
    expect(res.unattributed[0].count).toBeGreaterThan(0);
    const listed = res.entries.find((e) => e.id === sakuraStay)!;
    expect(listed.contribution).toBe(0);
    expect(listed.subtitle).toEqual({
      key: "evidence.subtitle.notConverted",
      values: { amount: 40000, currency: "JPY" },
    });
    assertSumInvariant(res, (n) => Math.round(n * 100) / 100);
  });

  /**
   * The nights measure does NOT abstain — two of its three nights are known,
   * so the figure exists. What the unknown stay gets is a zero the reader can
   * see the reason for, which is the trade this family makes deliberately:
   * `unattributed` counts units of the MEASURE, and nobody knows how many
   * NIGHTS an undated stay was, so a count of STAYS put there would be added
   * to a total of nights by `assertSumInvariant`.
   */
  it("lodgingNightsTotal: the stay of unknown length contributes 0 and says why", () => {
    const res = answers.get("lodgingNightsTotal")!;
    expect(res.measure.value).toBe(2);
    expect(res.entries.find((e) => e.id === sakuraStay)!.contribution).toBe(2);
    const unknown = res.entries.find((e) => e.id === casaStay)!;
    expect(unknown.contribution).toBe(0);
    expect(unknown.subtitle).toEqual({ key: "evidence.subtitle.nightsUnknown" });
    // The stay that CAN be measured carries no such subtitle — otherwise the
    // assertion above would pass on a resolver that marked every row.
    expect(res.entries.find((e) => e.id === sakuraStay)!.subtitle).toBeNull();
    expect(res.unattributed).toEqual([]);
    assertSumInvariant(res, Math.round);
  });

  /**
   * The degenerate case the `{count: 0}` rule exists for: a scope with no row
   * at all. Nothing was recorded, so nothing was spent — 0 with an EMPTY
   * bucket, never a null explained by zero rows, which would satisfy
   * `requireReasonForNull` while saying nothing.
   */
  it("reports 0 with no bucket for a year that holds nothing to abstain about", async () => {
    for (const key of ["cruiseTotalSpend", "lodgingSpendTotal"]) {
      const res = await request(app)
        .get(`/api/v1/evidence/metric/${key}`)
        .query({ period: "year", year: 2019 })
        .set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 200]);
      expect([key, res.body.measure.value]).toEqual([key, 0]);
      expect([key, res.body.unattributed]).toEqual([key, []]);
      expect([key, res.body.entries]).toEqual([key, []]);
    }
  });
});

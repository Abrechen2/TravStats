/**
 * The guard that makes `services/lodging/listSql.ts` safe to have at all.
 *
 * That module restates four rules the project keeps in exactly one home each —
 * `shared/lodgingCounting.ts` (does a stay count), `shared/lodgingTiming.ts`
 * (how many nights, and which day a stay is anchored to),
 * `shared/lodgingSpendBase.ts` (what a stay contributes to a base-currency
 * sum) and `shared/lodgingLifecycle.ts` (what the status pill says) — because
 * ordering and totalling a list by a derived value cannot be done in the
 * application without loading the whole list first. A restatement nobody
 * measures is how the row and the total under it come to disagree, so this
 * runs both spellings over ONE fixture and asserts they answer identically,
 * stay by stay.
 *
 * The fixture is deliberately built from the awkward cases rather than the
 * happy one: the cancelled stay with past dates, the undated stay whose stored
 * status is all there is, the stay in progress, the MONTH-precision stay whose
 * placeholder dates must not be differenced, the row whose `date_precision`
 * holds a word neither side knows, the stay priced in the base currency whose
 * snapshot names another, and the reversed date pair. Every one of them is a
 * branch that reads the same in a casual glance and differently in fact.
 */
import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { hashPassword } from "../../../utils/password";
import {
  stayAnchorSql,
  stayBaseAmountSql,
  stayCountsSql,
  stayNightsSql,
  ratingAvgSql,
  lifecycleRankSql,
} from "../listSql";
import { classifyStay } from "../../../shared/lodgingCounting";
import { resolveStayTiming } from "../../../shared/lodgingTiming";
import { lodgingBaseAmount } from "../../../shared/lodgingSpendBase";
import { lodgingLifecycleRank } from "../../../shared/lodgingLifecycle";
import { deriveOverallRating } from "../listView";

const USERNAME = "lodgingsqlparity";
/** One fixed moment, so "past" and "future" mean the same thing on both sides. */
const NOW = new Date("2026-06-15T12:00:00.000Z");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

interface StayRow {
  id: string;
  counts: boolean;
  nights: number;
  baseAmount: number | null;
  anchor: Date | null;
}

describe("listSql — the SQL restatement answers what the shared rules answer", () => {
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.lodging.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });

    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Parity House", country: "DE", isoCountryCode: "DE" },
    });
    lodgingId = lodging.id;

    const stays: Prisma.LodgingStayUncheckedCreateInput[] = [
      // A cancellation is a user statement and beats every date.
      {
        userId,
        lodgingId,
        status: "cancelled",
        checkIn: day("2024-03-01"),
        checkOut: day("2024-03-04"),
        datePrecision: "DAY",
        totalPrice: 400,
        currency: "EUR",
        ratingOverall: 5,
      },
      // Over: counts, nights from the dates, priced in the base currency.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2024-05-01"),
        checkOut: day("2024-05-04"),
        datePrecision: "DAY",
        totalPrice: 300,
        currency: "EUR",
        ratingOverall: 4,
      },
      // Undated: nothing to derive from, so the stored status IS the answer.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: null,
        checkOut: null,
        datePrecision: "NONE",
        nights: 2,
        totalPrice: 120,
        currency: "EUR",
        ratingOverall: 3,
      },
      // Undated and not completed: no dates to overrule the column.
      {
        userId,
        lodgingId,
        status: "scheduled",
        checkIn: null,
        checkOut: null,
        datePrecision: "NONE",
        nights: 5,
        totalPrice: 999,
        currency: "EUR",
      },
      // Entirely ahead of NOW.
      {
        userId,
        lodgingId,
        status: "scheduled",
        checkIn: day("2026-08-01"),
        checkOut: day("2026-08-08"),
        datePrecision: "DAY",
        totalPrice: 700,
        currency: "EUR",
      },
      // In progress — the rule is "until the check-out is past", so not yet.
      {
        userId,
        lodgingId,
        status: "in_progress",
        checkIn: day("2026-06-14"),
        checkOut: day("2026-06-18"),
        datePrecision: "DAY",
        totalPrice: 400,
        currency: "EUR",
      },
      // MONTH precision: the placeholder dates must not be differenced.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2011-07-01"),
        checkOut: day("2011-07-31"),
        datePrecision: "MONTH",
        nights: 3,
        totalPrice: 250,
        currency: "CHF",
        totalPriceBase: 230,
        fxBaseCurrency: "EUR",
      },
      // A precision neither side has a branch for: both must read it as DAY.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2023-02-01"),
        checkOut: day("2023-02-06"),
        datePrecision: "WEEK",
        nights: 99,
        totalPrice: 500,
        currency: "USD",
        totalPriceBase: 480,
        fxBaseCurrency: "USD",
      },
      // Dates present but the precision says NONE: no anchor, nights explicit.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2019-09-09"),
        checkOut: day("2019-09-12"),
        datePrecision: "NONE",
        nights: 1,
        totalPrice: 80,
        currency: "EUR",
        ratingOverall: 2,
      },
      // Reversed pair: `now >= GREATEST(in, out)` and the TypeScript's
      // `now < start` guard have to reach the same verdict.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2027-01-10"),
        checkOut: day("2020-01-01"),
        datePrecision: "DAY",
        nights: 4,
      },
      // Priced in the base currency, snapshot in another: the price wins.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2022-04-01"),
        checkOut: day("2022-04-03"),
        datePrecision: "DAY",
        totalPrice: 210,
        currency: "EUR",
        totalPriceBase: 190,
        fxBaseCurrency: "USD",
      },
      // No price at all, and a rating — pins that AVG ignores the unrated.
      {
        userId,
        lodgingId,
        status: "completed",
        checkIn: day("2021-10-01"),
        checkOut: day("2021-10-02"),
        datePrecision: "DAY",
      },
    ];
    for (const stay of stays) await prisma.lodgingStay.create({ data: stay });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("agrees stay by stay on counting, nights, base amount and anchor", async () => {
    const rows = await prisma.$queryRaw<StayRow[]>(Prisma.sql`
      SELECT s.id,
             ${stayCountsSql(NOW)} AS "counts",
             ${stayNightsSql()}::int AS "nights",
             ${stayBaseAmountSql("EUR")} AS "baseAmount",
             ${stayAnchorSql()} AS "anchor"
      FROM lodging_stays s
      WHERE s.lodging_id = ${lodgingId}
      ORDER BY s.id
    `);
    const stays = await prisma.lodgingStay.findMany({
      where: { lodgingId },
      orderBy: { id: "asc" },
    });
    expect(rows).toHaveLength(stays.length);
    expect(stays.length).toBeGreaterThan(10);

    for (const [index, stay] of stays.entries()) {
      const sql = rows[index];
      const where = `stay ${stay.datePrecision}/${stay.status} (${stay.id})`;
      expect(`${where}: ${sql.counts}`).toBe(`${where}: ${classifyStay(stay, NOW) === "visited"}`);
      const timing = resolveStayTiming(stay);
      expect(`${where}: ${sql.nights}`).toBe(`${where}: ${timing.nights}`);
      expect(`${where}: ${sql.baseAmount}`).toBe(
        `${where}: ${lodgingBaseAmount(stay, "EUR") ?? null}`
      );
      expect(`${where}: ${sql.anchor?.toISOString() ?? null}`).toBe(
        `${where}: ${timing.anchor?.toISOString() ?? null}`
      );
    }
  });

  it("agrees on the house's totals: stays that count, nights, spend and rating", async () => {
    const [row] = await prisma.$queryRaw<
      Array<{ stayCount: number; nights: number; spend: number; rating: number | null }>
    >(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE ${stayCountsSql(NOW)})::int AS "stayCount",
             COALESCE(SUM(${stayNightsSql()}) FILTER (WHERE ${stayCountsSql(NOW)}), 0)::int AS "nights",
             COALESCE(SUM(${stayBaseAmountSql("EUR")}) FILTER (WHERE ${stayCountsSql(NOW)}), 0) AS "spend",
             ${ratingAvgSql(NOW)} AS "rating"
      FROM lodging_stays s
      WHERE s.lodging_id = ${lodgingId}
    `);

    const stays = await prisma.lodgingStay.findMany({ where: { lodgingId } });
    const visited = stays.filter((s) => classifyStay(s, NOW) === "visited");
    expect(row.stayCount).toBe(visited.length);
    expect(row.nights).toBe(visited.reduce((sum, s) => sum + resolveStayTiming(s).nights, 0));
    expect(row.spend).toBeCloseTo(
      visited.reduce((sum, s) => sum + (lodgingBaseAmount(s, "EUR") ?? 0), 0),
      6
    );
    expect(row.rating === null ? null : Number(row.rating)).toBe(deriveOverallRating(visited));
  });

  it("agrees on the lifecycle rank the status pill and its filter read", async () => {
    const [row] = await prisma.$queryRaw<Array<{ rank: number }>>(Prisma.sql`
      SELECT ${lifecycleRankSql()} AS "rank"
      FROM lodgings l
      LEFT JOIN lodging_stays s ON s.lodging_id = l.id
      WHERE l.id = ${lodgingId}
      GROUP BY l.id
    `);
    const stays = await prisma.lodgingStay.findMany({ where: { lodgingId } });
    expect(Number(row.rank)).toBe(lodgingLifecycleRank(stays));

    const empty = await prisma.lodging.create({ data: { userId, name: "Bookmarked only" } });
    const [emptyRow] = await prisma.$queryRaw<Array<{ rank: number }>>(Prisma.sql`
      SELECT ${lifecycleRankSql()} AS "rank"
      FROM lodgings l
      LEFT JOIN lodging_stays s ON s.lodging_id = l.id
      WHERE l.id = ${empty.id}
      GROUP BY l.id
    `);
    // A house with no stays at all ranks after all four states, on both sides.
    expect(Number(emptyRow.rank)).toBe(lodgingLifecycleRank([]));
  });
});

/**
 * Reading the lodging list: which rows, in what order, with what totals.
 *
 * Moved out of `routes/lodging.ts` on 2026-09-15, which sat at the 800-line
 * limit. The grouping stands on its own: every function below answers a
 * question about a COLLECTION of lodgings — which rows, in what order, with
 * what totals — and none of it is routing.
 */

import { Prisma } from "../../prisma";

import { classifyStay } from "../../shared/lodgingCounting";
import { lodgingBaseAmount, type LodgingStayFx } from "../../shared/lodgingSpendBase";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import type { LodgingQueryInput } from "../../schemas/lodging";
import type { LodgingListRow } from "../../routes/lodging";

export interface RatedStay {
  ratingOverall: number | null;
}

/** The price columns the spend rule reads — `shared/lodgingSpendBase.ts`
 *  owns the rule itself, so this list is its interface, not a second copy. */
export type AggregateStayFx = LodgingStayFx;

/**
 * Sums each stay's amount under the currency it is an amount IN — never
 * across currencies.
 *
 * A stay reaching TODAY's base currency is booked there, whether by being
 * priced in it or by a snapshot taken in it; `lodgingBaseAmount` decides.
 * Everything else that HAS a snapshot is booked under the currency that
 * snapshot was taken in, and stays there: a stay snapshotted before the user
 * switched their base currency keeps its OLD `fxBaseCurrency` forever (the
 * snapshot is never recalculated), so summing everything under the current
 * label would silently add amounts that were never converted into it
 * (finding 2).
 *
 * This is the list column's half of the same rule `calculateLodgingStats`
 * applies to the stats tab. Two spellings of it would let a house's spend on
 * the list disagree with the total on the tab that is summed from the same
 * stays.
 */
export function sumSpendBaseByCurrency<T extends AggregateStayFx>(
  stays: T[],
  currentBaseCurrency: string
): Record<string, number> {
  const byCurrency: Record<string, number> = {};
  for (const s of stays) {
    const baseAmount = lodgingBaseAmount(s, currentBaseCurrency);
    if (baseAmount !== null) {
      byCurrency[currentBaseCurrency] = (byCurrency[currentBaseCurrency] ?? 0) + baseAmount;
      continue;
    }
    if (s.totalPriceBase === null || s.fxBaseCurrency === null) continue;
    byCurrency[s.fxBaseCurrency] = (byCurrency[s.fxBaseCurrency] ?? 0) + s.totalPriceBase;
  }
  return byCurrency;
}

/** Average of a lodging's stays' ratingOverall (nulls ignored). null when none rated. */
export function deriveOverallRating(stays: RatedStay[]): number | null {
  const rated = stays.map((s) => s.ratingOverall).filter((v): v is number => v !== null);
  if (rated.length === 0) return null;
  return Math.round((rated.reduce((sum, v) => sum + v, 0) / rated.length) * 10) / 10;
}

export interface AggregateStay extends RatedStay, AggregateStayFx {
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
  status: string;
}

export interface LodgingAggregates {
  overallRating: number | null;
  stayCount: number;
  nights: number;
  /** Sum of the amounts that reach `currentBaseCurrency` — see sumSpendBaseByCurrency. */
  totalSpendBase: number;
  /** Full per-currency breakdown (finding 2) — lets the UI show spend snapshotted under a currency the user has since moved away from, instead of silently folding it into totalSpendBase. */
  totalSpendBaseByCurrency: Record<string, number>;
}

export function computeAggregates(
  stays: AggregateStay[],
  currentBaseCurrency: string
): LodgingAggregates {
  // The check-out rule (shared/lodgingCounting): a stay counts once it is
  // over. Future and cancelled bookings contribute nothing to any figure —
  // the same verdict the stats path (calculateLodgingStats) already applies.
  const visited = stays.filter((s) => classifyStay(s) === "visited");
  const totalSpendBaseByCurrency = sumSpendBaseByCurrency(visited, currentBaseCurrency);
  return {
    overallRating: deriveOverallRating(visited),
    stayCount: visited.length,
    // Nights come from `resolveStayTiming`, not from a local date subtraction:
    // an undated stay can still carry an explicit night count, and a
    // month-precision one must not have its placeholder dates differenced.
    nights: visited.reduce((sum, s) => sum + resolveStayTiming(s).nights, 0),
    totalSpendBase: totalSpendBaseByCurrency[currentBaseCurrency] ?? 0,
    totalSpendBaseByCurrency,
  };
}

export type LodgingListItem = LodgingListRow & LodgingAggregates;

export function sortLodgings(
  items: LodgingListItem[],
  sort: LodgingQueryInput["sort"]
): LodgingListItem[] {
  switch (sort) {
    case "name":
      return [...items].sort((a, b) => a.name.localeCompare(b.name));
    case "nights":
      return [...items].sort((a, b) => b.nights - a.nights);
    case "rating":
      return [...items].sort((a, b) => (b.overallRating ?? -1) - (a.overallRating ?? -1));
    case "spend":
      return [...items].sort((a, b) => b.totalSpendBase - a.totalSpendBase);
    case "checkIn": {
      const latestCheckIn = (l: LodgingListItem) =>
        // An undated stay has no position on this axis. It sorts as if it were
        // the oldest thing in the list rather than jumping to the top on a NaN.
        l.stays.reduce((max, s) => Math.max(max, s.checkIn?.getTime() ?? 0), 0);
      return [...items].sort((a, b) => latestCheckIn(b) - latestCheckIn(a));
    }
    default:
      return items; // already ordered by createdAt desc from the DB query
  }
}

export function buildLodgingWhere(q: LodgingQueryInput, userId: string): Prisma.LodgingWhereInput {
  const where: Prisma.LodgingWhereInput = { userId };
  if (q.type) where.type = q.type;
  if (q.chainId) where.chainId = q.chainId;
  // The filter sends an ISO code now ("DE"), so one option covers "Deutschland"
  // AND "Germany". A non-code value is still accepted verbatim: an older client
  // — and any house whose text resolves to no country at all — must keep working.
  if (q.country) {
    if (/^[A-Za-z]{2}$/.test(q.country)) where.isoCountryCode = q.country.toUpperCase();
    else where.country = q.country;
  }

  const stayFilter: Prisma.LodgingStayWhereInput = {};
  if (q.tripId) stayFilter.tripId = q.tripId;
  if (q.year) {
    stayFilter.checkIn = {
      gte: new Date(`${q.year}-01-01T00:00:00.000Z`),
      lt: new Date(`${q.year + 1}-01-01T00:00:00.000Z`),
    };
  }
  if (Object.keys(stayFilter).length > 0) where.stays = { some: stayFilter };

  return where;
}

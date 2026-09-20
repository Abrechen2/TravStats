/**
 * Reading the lodging list: which rows, in what order, with what totals.
 *
 * Moved out of `routes/lodging.ts` on 2026-09-15, which sat at the 800-line
 * limit. The grouping stands on its own: every function below answers a
 * question about a COLLECTION of lodgings — which rows, in what order, with
 * what totals — and none of it is routing.
 *
 * ORDERING left on 2026-09-20. `sortLodgings` and `buildLodgingWhere` lived
 * here and are gone: both only ever served a handler that sorted and filtered
 * the whole library in memory to slice one page out of it, and that page is
 * decided in SQL now (`listQuery.ts`). What remains is the derivation of what
 * a ROW SHOWS, which is still the shared rules' answer and not the database's.
 */

import { classifyStay } from "../../shared/lodgingCounting";
import { lodgingBaseAmount, type LodgingStayFx } from "../../shared/lodgingSpendBase";
import { resolveStayTiming } from "../../shared/lodgingTiming";
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

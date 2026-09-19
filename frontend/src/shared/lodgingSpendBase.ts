/**
 * What a stay contributes to a base-currency lodging sum — the ONE answer.
 *
 * The backend asks it in four places (the per-night price, the stats
 * rollup's `spendBaseTotal`, the per-lodging list column and the evidence
 * panel) and this side asks it once, in `countUnconvertedStays` — the
 * footnote under a total that silently omits rows. A total and its footnote
 * disagreeing is the worst of the failures here: the figure reads complete
 * while the line under it names rows that are in fact included.
 *
 * The rule, in order:
 *
 * 1. A stay priced in the base currency counts at its own price — no
 *    conversion, and therefore no FX snapshot required. 300 EUR in a EUR
 *    logbook is 300 EUR.
 * 2. Otherwise its snapshot, and only where that snapshot was taken in
 *    TODAY's base currency.
 *
 * Step 1 is why this file exists. Every stay entered before the snapshot
 * columns shipped carries `totalPriceBase: null`, so without it a whole
 * logbook's lodging spend fell out of `spendBaseTotal`, landed in
 * `spendUnconvertedStays`, and drew a footnote saying a rate was missing for
 * stays that needed none. The same defect was measured on the cruise money
 * tile on 2026-09-19 — a derivation that insists on a new column treats every
 * pre-existing row as worthless. `utils/stats/dedupedCost.ts` has carried the
 * branch for flights since #267.
 *
 * Step 2's currency check is the older half of the rule and stays: a snapshot
 * taken under a base currency the account has since left is a real number in a
 * currency this sum no longer speaks, and adding it would be #267 one level
 * down. Such a stay is reported by `spendBaseByCurrency` under the currency it
 * WAS converted into, never folded in here.
 *
 * MIRRORED from `backend/src/shared/lodgingSpendBase.ts`. Nothing checks that
 * the two sides agree — each has its own test of the same truth table, which
 * is the convention here, not a guard. Change both together.
 */

/** The columns this rule reads. Deliberately structural: the stats rollup, the
 *  list view and the evidence resolver each carry their own stay shape. */
export interface LodgingStayFx {
  totalPrice: number | null;
  currency: string | null;
  totalPriceBase: number | null;
  fxBaseCurrency: string | null;
}

/**
 * Whether the stay carries a price at all.
 *
 * `null` is "no price"; a real 0 is a price — an award night entered as 0 is
 * a stay that honestly cost nothing, and sweeping it in with the priceless
 * ones is how "all free" gets printed over a bill. Unlike the cruise rule
 * (the backend's `services/stats/cruiseSpendBase.ts`), which reads 0 as
 * unpriced because a
 * cruise has no award concept.
 */
export function isPricedStay(stay: LodgingStayFx): stay is LodgingStayFx & { totalPrice: number } {
  return stay.totalPrice !== null;
}

/**
 * The stay's amount IN `baseCurrency`, or null when nothing honest can be
 * said about it.
 *
 * The own-currency branch is tried FIRST, so a stay priced in the base
 * currency counts at its own price even where the snapshot names another
 * currency. An account that moved its base currency and moved back holds
 * exactly such stays, and there the snapshot is the stale reading — the price
 * is not.
 *
 * A missing `currency` reads as EUR, matching the schema default on the
 * column and every other reader of it (`spendByCurrency`, the evidence
 * subtitle). Reading the raw column instead would let one stay be labelled
 * EUR by the per-currency breakdown and excluded for not being EUR by this.
 */
export function lodgingBaseAmount(stay: LodgingStayFx, baseCurrency: string): number | null {
  if (isPricedStay(stay) && (stay.currency ?? "EUR") === baseCurrency) return stay.totalPrice;
  return stay.totalPriceBase !== null && stay.fxBaseCurrency === baseCurrency
    ? stay.totalPriceBase
    : null;
}

/**
 * Whether this stay's price reached no base-currency sum AND has no snapshot
 * under any other base currency either — the footnote's population.
 *
 * Deliberately narrower than "did not contribute": a stay converted under an
 * OLDER base currency is not counted here, because it HAS a rate and is
 * reported by `spendBaseByCurrency` instead. Counting it twice would put one
 * stay behind two different hints.
 */
export function isUnconvertedSpend(stay: LodgingStayFx, baseCurrency: string): boolean {
  return (
    isPricedStay(stay) &&
    lodgingBaseAmount(stay, baseCurrency) === null &&
    stay.totalPriceBase === null
  );
}

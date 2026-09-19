/**
 * What sailed cruises cost, expressed in the account's CURRENT base currency.
 *
 * ONE rule, read twice. `GET /stats/cruise` puts this figure on the cruise
 * tab's money tile and `resolveCruiseTotalSpend` answers the evidence panel
 * for the same key, so the two would disagree the day either re-spelled the
 * predicate — which is precisely what the panel exists to make impossible.
 * The rule itself is `services/trip/tripCostSuperlative.ts`'s, one domain
 * narrower: a price, a snapshot, and the snapshot taken in the currency the
 * sum is being computed in.
 *
 * A snapshot in a STALE base currency counts as no snapshot at all. The stored
 * number is real, but real in a currency this sum no longer speaks — adding it
 * would be the very defect (#267) the snapshot exists to prevent, one level
 * down. Such a cruise is EXCLUDED and counted, never silently converted and
 * never quietly dropped: the tile names how many cruises stayed out.
 *
 * `value` is null — abstention, never 0 — when no cruise in scope reached the
 * base currency, because a zero would claim the sailing was free. With no
 * cruise in scope at all, 0 is the honest answer and there is nothing to
 * abstain about.
 */
import type { CruiseStatsRow } from "./cruiseStatsData";

/** The wire shape `GET /stats/cruise` carries as `totalSpendBase`. */
export interface CruiseSpendBase {
  /** Base-currency sum, or null when nothing in scope could be converted. */
  value: number | null;
  /** Priced cruises whose price could NOT be converted to `currency`. */
  excludedCount: number;
  /** The account's base currency — what `value` is denominated in. */
  currency: string;
}

/**
 * Whether the cruise carries a price at all.
 *
 * A null or zero price is "no price", matching the client fold's own
 * `typeof price === "number" && price > 0` and `bookingCost.sumByCurrency`.
 * An unpriced cruise is not an exclusion: nothing was withheld from the total.
 */
export function isPricedCruise(row: CruiseStatsRow): boolean {
  return row.price !== null && row.price > 0;
}

/** The snapshot amount, or null when there is none in TODAY's base currency. */
export function cruiseBaseAmount(row: CruiseStatsRow, baseCurrency: string): number | null {
  return row.priceBase !== null && row.fxBaseCurrency === baseCurrency ? row.priceBase : null;
}

/** Money is rounded to the minor unit once, at the end — never per cruise. */
function toMinorUnit(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** The base-currency total of `rows`, with what it had to leave out. */
export function cruiseTotalSpendBase(
  rows: readonly CruiseStatsRow[],
  baseCurrency: string
): CruiseSpendBase {
  const priced = rows.filter(isPricedCruise);
  const converted = priced
    .map((row) => cruiseBaseAmount(row, baseCurrency))
    .filter((amount): amount is number => amount !== null);
  const abstains = converted.length === 0 && rows.length > 0;
  return {
    value: abstains ? null : toMinorUnit(converted.reduce((sum, amount) => sum + amount, 0)),
    excludedCount: priced.length - converted.length,
    currency: baseCurrency,
  };
}

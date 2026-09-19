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
 * A price ALREADY in the base currency needs neither conversion nor snapshot:
 * 300 EUR in a EUR logbook is 300 EUR. That shortcut is not tidiness, it is
 * the difference between a figure and a dash. Measured on the public beta on
 * 2026-09-19: the tile drew "—" over "19 Kreuzfahrten ohne Kurs nicht
 * enthalten" in a EUR account whose 19 priced cruises were every one of them
 * priced in EUR — they predate the snapshot column (migration
 * `20260918201754_cruise_base_currency`), as does every seeded row, so
 * `priceBase` was null on all of them. A derivation that insists on a new
 * column treats every pre-existing row as worthless. `dedupedCost.ts` and
 * `businessStats.ts` have carried the same branch for flights since #267,
 * which is why the flight tiles never went blank.
 *
 * A snapshot in a STALE base currency counts as no snapshot at all. The stored
 * number is real, but real in a currency this sum no longer speaks — adding it
 * would be the very defect (#267) the snapshot exists to prevent, one level
 * down. Such a cruise is EXCLUDED and counted, never silently converted and
 * never quietly dropped: the tile names how many cruises stayed out. After the
 * shortcut above, an exclusion can only ever be a cruise in a FOREIGN currency
 * — which is what the tile's footnote now says.
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
 *
 * Spelled as a type predicate so that callers which have asked the question
 * may then READ the price without a non-null assertion — the alternative was
 * a second copy of `price !== null && price > 0` at each such site, and two
 * copies of a counting rule is the drift this file exists to prevent.
 */
export function isPricedCruise(row: CruiseStatsRow): row is CruiseStatsRow & { price: number } {
  return row.price !== null && row.price > 0;
}

/**
 * What this cruise adds to the base-currency sum, or null when nothing honest
 * can be said about it.
 *
 * Two ways to reach the base currency, tried in this order:
 *
 * 1. The price is already IN it — counted at its own price, no snapshot asked
 *    for. See the file header for what asking cost.
 * 2. Otherwise the FX snapshot, and only where it was taken in TODAY's base
 *    currency.
 *
 * The order is load-bearing, not incidental: a EUR cruise in a EUR account
 * counts at its own price even where the stored snapshot names some other
 * currency. An account that moved its base currency and moved back carries
 * exactly such rows, and the snapshot is the stale reading there — the price
 * is not.
 *
 * A missing `currency` reads as EUR, and the reason is a contradiction rather
 * than a convenience: `metricEvidenceCruise.ts` already prints such a row's
 * subtitle as `row.currency ?? "EUR"`, so comparing the raw column here made
 * ONE panel label an amount "EUR" and exclude it for not being EUR. The
 * column is `String? @default("EUR")` and the API schema cannot deliver null,
 * so a stored NULL is somebody having written null — not an unknown
 * denomination this sum would be guessing at.
 */
export function cruiseBaseAmount(row: CruiseStatsRow, baseCurrency: string): number | null {
  if (isPricedCruise(row) && (row.currency ?? "EUR") === baseCurrency) return row.price;
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

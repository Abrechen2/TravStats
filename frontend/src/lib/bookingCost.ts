import { isAmountRecorded } from "../shared/flightPricing";

/** A booking or a flight — anything that may carry a price. Both fields are
 *  optional because a flight type declares them so. */
export interface BookingCostInput {
  price?: number | null;
  currency?: string | null;
}

export interface CurrencyTotal {
  currency: string;
  total: number;
}

/**
 * What a whole TRIP cost is not summed here: the server owns that rule
 * (`backend/src/shared/tripCost.ts`, forgejo#274) and sends `trip.cost`; the
 * client-side `tripCostSources` that used to rebuild it — bare flight prices,
 * no trains, no rentals — is gone. `tripCostTotals` (lib/tripCost.ts) lays the
 * server's figure out through the function below.
 */

/** Per-currency totals over anything that carries a price. Currencies are
 *  NEVER summed together (no FX in 2.5); null currency means the schema
 *  default EUR. EUR sorts first, the rest alphabetical.
 *
 *  A null price is "no price"; a 0 is a price (a free award booking, a comped
 *  stay), by `shared/flightPricing.isAmountRecorded` — the rule flights,
 *  cruises and the backend `tripCostSuperlative` already follow. `price <= 0`
 *  here made a trip priced only at 0 read "—", as if nothing were written down.
 *  A 0 is 0 in every currency, so it needs no rate: zero-total buckets are
 *  dropped beside real money (no "300 € + 0 $") and fold into ONE bucket when
 *  nothing else is priced, so a free trip reads "0 €", not "0 € + 0 $". */
export function sumByCurrency(bookings: BookingCostInput[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const b of bookings) {
    if (!isAmountRecorded(b.price)) continue;
    const currency = b.currency ?? "EUR";
    totals.set(currency, (totals.get(currency) ?? 0) + b.price);
  }
  const sorted = [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => {
      if (a.currency === "EUR") return -1;
      if (b.currency === "EUR") return 1;
      return a.currency.localeCompare(b.currency);
    });
  const nonZero = sorted.filter((t) => t.total !== 0);
  return nonZero.length > 0 ? nonZero : sorted.slice(0, 1);
}

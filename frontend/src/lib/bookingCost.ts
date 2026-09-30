import { isAmountRecorded } from "../shared/flightPricing";
import { deriveStayTotalPrice, type StayPricingInput } from "../shared/stayPricing";

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

/** Anything that may carry a price of its own rather than through a booking. */
type PricedItem = BookingCostInput & { bookingId?: string | null };

/**
 * A lodging stay prices itself as `totalPrice`, not `price`, and carries an FX
 * snapshot (`totalPriceBase`/`fxRate`) that the rest of the cost model has no
 * concept of. Only the raw amount and its own currency feed the trip total —
 * `sumByCurrency` never converts, so the base-currency figure would be a second
 * opinion about the same money rather than an addition.
 *
 * The total is authoritative and derived on write (backend
 * `shared/stayPricing.deriveStayTotalPrice`, plus a one-off backfill of legacy
 * rows). The per-night fields stay on the type only as the shared helper's
 * transitional fallback for anything the backend has not yet normalised.
 */
export type LodgingCostInput = StayPricingInput & {
  currency?: string | null;
  bookingId?: string | null;
};

/**
 * What a stay contributes to the trip total. Delegates to the ONE shared
 * derivation so frontend and backend can never disagree about a stay's price —
 * the duplicate per-night arm that used to live here is gone. A stay entered as
 * free stays 0 here too; turning it back into null undid AUD-041 one layer up.
 */
export function stayCost(stay: LodgingCostInput): number | null {
  return deriveStayTotalPrice(stay);
}

/**
 * Everything on a trip that carries a price: its bookings, plus the flights,
 * cruises and lodging stays that have none. A hand-entered flight price used to
 * vanish from the trip total because the cost model read bookings only — you
 * typed 249.99 € on the flight and the trip still said "—". A cruise price
 * vanished the same way, which left a cruise-only trip totalling to "—"
 * outright, and a hotel-only trip did the same until stays were folded in.
 *
 * Double counting is structurally impossible: import moves an identical
 * per-segment total onto the Booking and nulls the segments, so an item with a
 * bookingId no longer carries a price of its own. Filtering on bookingId keeps
 * that guarantee explicit rather than relying on the nulling.
 */
export function tripCostSources(
  bookings: BookingCostInput[],
  flights: PricedItem[] = [],
  cruises: PricedItem[] = [],
  stays: LodgingCostInput[] = []
): BookingCostInput[] {
  const unbooked = <T extends { bookingId?: string | null }>(items: T[]): T[] =>
    items.filter((i) => !i.bookingId);
  const stayPrices: PricedItem[] = unbooked(stays).map((s) => ({
    price: stayCost(s),
    currency: s.currency,
  }));
  return [...bookings, ...unbooked(flights), ...unbooked(cruises), ...stayPrices];
}

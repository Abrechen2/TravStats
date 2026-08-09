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
 *  default EUR; a null or zero price counts as "no price". EUR sorts first,
 *  the rest alphabetical. */
export function sumByCurrency(bookings: BookingCostInput[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const b of bookings) {
    if (b.price == null || b.price <= 0) continue;
    const currency = b.currency ?? "EUR";
    totals.set(currency, (totals.get(currency) ?? 0) + b.price);
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => {
      if (a.currency === "EUR") return -1;
      if (b.currency === "EUR") return 1;
      return a.currency.localeCompare(b.currency);
    });
}

/** Anything that may carry a price of its own rather than through a booking. */
type PricedItem = BookingCostInput & { bookingId?: string | null };

/**
 * A lodging stay prices itself as `totalPrice`, not `price`, and carries an FX
 * snapshot (`totalPriceBase`/`fxRate`) that the rest of the cost model has no
 * concept of. Only the raw amount and its own currency feed the trip total —
 * `sumByCurrency` never converts, so the base-currency figure would be a second
 * opinion about the same money rather than an addition.
 */
export interface LodgingCostInput {
  totalPrice?: number | null;
  currency?: string | null;
  bookingId?: string | null;
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
    price: s.totalPrice,
    currency: s.currency,
  }));
  return [...bookings, ...unbooked(flights), ...unbooked(cruises), ...stayPrices];
}

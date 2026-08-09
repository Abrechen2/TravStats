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
 * Everything on a trip that carries a price: its bookings, plus the flights and
 * cruises that have none. A hand-entered flight price used to vanish from the
 * trip total because the cost model read bookings only — you typed 249.99 € on
 * the flight and the trip still said "—". A cruise price vanished the same way,
 * which left a cruise-only trip totalling to "—" outright.
 *
 * Double counting is structurally impossible: import moves an identical
 * per-segment total onto the Booking and nulls the segments, so an item with a
 * bookingId no longer carries a price of its own. Filtering on bookingId keeps
 * that guarantee explicit rather than relying on the nulling.
 */
export function tripCostSources(
  bookings: BookingCostInput[],
  flights: PricedItem[] = [],
  cruises: PricedItem[] = []
): BookingCostInput[] {
  const unbooked = (items: PricedItem[]): PricedItem[] => items.filter((i) => !i.bookingId);
  return [...bookings, ...unbooked(flights), ...unbooked(cruises)];
}

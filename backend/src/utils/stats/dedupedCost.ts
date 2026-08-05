export interface CostFlight {
  price: number | null;
  taxes: number | null;
  fees: number | null;
  bookingId: string | null;
  booking: { price: number | null } | null;
}

/**
 * Total cost with booking dedupe — the SAME rules as businessStats.ts:52-62
 * (kept in sync by hand; businessStats' loop also attributes distance, so the
 * rule is knowingly duplicated, not shared): a booking price counts once per
 * booking and is all-in (per-flight taxes/fees NOT added on top); flights
 * without a priced booking fall back to price + taxes + fees. Truthiness
 * matches businessStats: booking price 0/null -> fallback.
 */
export function computeDedupedTotalCost(flights: CostFlight[]): number {
  const seenBookingIds = new Set<string>();
  let total = 0;
  for (const flight of flights) {
    if (flight.bookingId && flight.booking?.price) {
      if (!seenBookingIds.has(flight.bookingId)) {
        seenBookingIds.add(flight.bookingId);
        total += flight.booking.price;
      }
    } else {
      total += (flight.price ?? 0) + (flight.taxes ?? 0) + (flight.fees ?? 0);
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * The authoritative total price of a lodging stay.
 *
 * `totalPrice` is the source of truth (the StayEditor types it and derives the
 * per-night figure from it for display). But the import and API paths can send
 * a per-night price with no total, so this fills that gap: when no total was
 * given, it is total = per-night × nights. A stored total always wins, even if
 * it disagrees with per-night × nights (a package rate is not nights × rack).
 *
 * Mirror of frontend/src/shared/stayPricing.ts — keep both in sync.
 */
export interface StayPricingInput {
  totalPrice?: number | null;
  pricePerNight?: number | null;
  checkIn?: string | Date | null;
  checkOut?: string | Date | null;
}

/** Whole nights between two dates. Rounded, not floored: the stamps are
 *  hotel-local calendar dates and a DST hour must not eat a night. */
export function nightsBetween(
  checkIn: string | Date | null | undefined,
  checkOut: string | Date | null | undefined
): number {
  if (!checkIn || !checkOut) return 0;
  const inMs = new Date(checkIn).getTime();
  const outMs = new Date(checkOut).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return 0;
  return Math.max(0, Math.round((outMs - inMs) / 86_400_000));
}

/** The stay's total price, deriving it from per-night × nights only when no
 *  total was supplied. Returns null when neither yields a positive amount. */
export function deriveStayTotalPrice(stay: StayPricingInput): number | null {
  if (stay.totalPrice != null && stay.totalPrice > 0) return stay.totalPrice;
  if (stay.pricePerNight != null && stay.pricePerNight > 0) {
    const nights = nightsBetween(stay.checkIn, stay.checkOut);
    if (nights > 0) return stay.pricePerNight * nights;
  }
  return null;
}

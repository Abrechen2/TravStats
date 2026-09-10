/**
 * The authoritative total price of a lodging stay.
 *
 * `totalPrice` is the source of truth (the StayEditor types it and derives the
 * per-night figure from it for display). But the import and API paths can send
 * a per-night price with no total, so this fills that gap: when no total was
 * given, it is total = per-night x nights. A stored total always wins, even if
 * it disagrees with per-night x nights (a package rate is not nights x rack).
 *
 * Two things this file got wrong for as long as it existed, both found by the
 * 2026-09-09 audit:
 *
 *  - It subtracted the two dates itself instead of asking the module whose only
 *    job is that question. So an undated stay with three explicit nights priced
 *    at 50 stored no total at all, and a MONTH-precision stay whose placeholder
 *    dates happen to sit a month apart stored 1550 instead of 150 (AUD-040).
 *    `resolveStayTiming` already answered both correctly; nothing asked it.
 *  - It treated a total of 0 as "no total" and fell back to the per-night
 *    price, so an award stay entered as free came back at 150 (AUD-041). Zero
 *    is a price. Absent is `null`, and the two must not collapse.
 *
 * Mirror of backend/src/shared/stayPricing.ts - keep both in sync.
 */
import { resolveStayTiming } from "./lodgingTiming";

export interface StayPricingInput {
  totalPrice?: number | null;
  pricePerNight?: number | null;
  checkIn?: string | Date | null;
  checkOut?: string | Date | null;
  /** How much of the dates is real. Absent means the caller has none to offer,
   *  which `resolveStayTiming` reads as DAY when both dates are present. */
  datePrecision?: string | null;
  /** Explicit night count, for a stay whose dates cannot supply one. */
  nights?: number | null;
}

/** Whole nights between two dates. Rounded, not floored: the stamps are
 *  hotel-local calendar dates and a DST hour must not eat a night.
 *
 *  Kept for callers that genuinely have two real days and nothing else; the
 *  price derivation below does NOT use it, because two dates alone cannot say
 *  whether they are days or placeholders. */
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

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The stay's total price, deriving it from per-night x nights only when no
 * total was supplied. Returns null when no amount can be stated — which is not
 * the same as 0, and never rounded up to it.
 */
export function deriveStayTotalPrice(stay: StayPricingInput): number | null {
  // Present wins, including 0. Only `null`/`undefined` means "not supplied".
  if (stay.totalPrice != null) return stay.totalPrice;
  if (stay.pricePerNight == null || stay.pricePerNight <= 0) return null;

  const timing = resolveStayTiming({
    checkIn: toDate(stay.checkIn),
    checkOut: toDate(stay.checkOut),
    datePrecision: stay.datePrecision ?? "DAY",
    nights: stay.nights ?? null,
  });
  // "Nobody knows how long" is not zero nights, and multiplying by it would
  // state a price nothing supports.
  if (!timing.nightsKnown || timing.nights <= 0) return null;
  return stay.pricePerNight * timing.nights;
}

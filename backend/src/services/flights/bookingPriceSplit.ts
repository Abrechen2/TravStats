import {
  storedBookingSplitSchema,
  type BookingSplitMethod,
  type StoredBookingSplit,
} from "../../schemas/flightBooking";

/**
 * Splitting a booking's all-in price across its flight segments
 * (forgejo#219) — optional, and for READING only.
 *
 * Three promises, each kept by construction rather than by care:
 * - **The total is preserved to the minor unit.** The split is done in whole
 *   cents (or yen, or fils — the currency's own minor unit) with the
 *   largest-remainder method on exact integers: every share is the floor of
 *   its exact part, and the cents left over go one each to the largest
 *   remainders. Nothing is rounded away and nothing is invented.
 * - **Nothing is counted twice.** The shares are stored on the BOOKING
 *   (`bookings.price_split`), not in the flights' own price columns, and no
 *   cost total reads them: `utils/stats/dedupedCost.ts` keeps counting the
 *   booking price once, all-in. Writing the shares into `flights.price`
 *   would have been the double count — the moment the booking price was
 *   cleared, the segments' own prices plus their taxes would sum to more
 *   than was paid.
 * - **A stale split says so.** The stored split names the price, currency
 *   and segments it was made from; a later change to any of them marks it
 *   stale (`readBookingSplit`) instead of showing shares that no longer add
 *   up to the total.
 */

/** Minor-unit digits of a currency (EUR 2, JPY 0, BHD 3); 2 where it is unknown. */
export function minorDigits(currency: string | null): number {
  if (!currency) return 2;
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * `total` split by integer `weights`, in minor units, largest remainder.
 * Ties go to the earlier position, so the answer is stable.
 */
export function splitMinorUnits(totalMinor: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) throw new RangeError("weights must sum to more than 0");
  const exact = weights.map((w) => totalMinor * w);
  const shares = exact.map((x) => Math.floor(x / sum));
  let left = totalMinor - shares.reduce((a, s) => a + s, 0);
  const order = exact
    .map((x, i) => ({ i, remainder: x % sum }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

export type SplitRefusalCode =
  | "BOOKING_PRICE_MISSING"
  | "BOOKING_SPLIT_SINGLE_SEGMENT"
  | "BOOKING_SPLIT_MIXED"
  | "BOOKING_SPLIT_DISTANCE_UNKNOWN";

export interface SplitSegment {
  id: string;
  routeDistance: number | null;
}

export interface SplitBooking {
  price: number | null;
  currency: string | null;
  /** Cruises, journeys and stays on the same booking: its price is not the flights' alone. */
  otherEntries: number;
}

/** The split to store, or the reason there is none. */
export function computeBookingSplit(
  booking: SplitBooking,
  segments: readonly SplitSegment[],
  method: BookingSplitMethod
): { split: StoredBookingSplit } | { refusal: SplitRefusalCode } {
  if (booking.price === null || !Number.isFinite(booking.price) || booking.price < 0) {
    return { refusal: "BOOKING_PRICE_MISSING" };
  }
  if (booking.otherEntries > 0) return { refusal: "BOOKING_SPLIT_MIXED" };
  if (segments.length < 2) return { refusal: "BOOKING_SPLIT_SINGLE_SEGMENT" };
  let weights: number[];
  if (method === "distance") {
    const km = segments.map((s) => (s.routeDistance === null ? 0 : Math.round(s.routeDistance)));
    if (km.some((d) => d <= 0)) return { refusal: "BOOKING_SPLIT_DISTANCE_UNKNOWN" };
    weights = km;
  } else {
    weights = segments.map(() => 1);
  }
  const digits = minorDigits(booking.currency);
  const scale = 10 ** digits;
  const minor = splitMinorUnits(Math.round(booking.price * scale), weights);
  return {
    split: {
      method,
      price: booking.price,
      currency: booking.currency,
      shares: segments.map((s, i) => ({ flightId: s.id, amount: minor[i] / scale })),
    },
  };
}

export type SplitStaleReason = "price" | "currency" | "segments";

export interface BookingSplitView extends StoredBookingSplit {
  /** Null while the split still describes the booking as it is now. */
  staleReason: SplitStaleReason | null;
}

/** The stored split, checked against the booking and its segments today. Null when none is stored. */
export function readBookingSplit(
  raw: unknown,
  booking: { price: number | null; currency: string | null },
  segmentIds: readonly string[]
): BookingSplitView | null {
  if (raw === null || raw === undefined) return null;
  const parsed = storedBookingSplitSchema.safeParse(raw);
  if (!parsed.success) return null;
  const split = parsed.data;
  const ids = new Set(segmentIds);
  const staleReason: SplitStaleReason | null =
    booking.price !== split.price
      ? "price"
      : booking.currency !== split.currency
        ? "currency"
        : split.shares.length !== ids.size || split.shares.some((s) => !ids.has(s.flightId))
          ? "segments"
          : null;
  return { ...split, staleReason };
}

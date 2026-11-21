/**
 * Splitting a package's price across its items, of any kind (forgejo#430).
 *
 * The same promises as the flight split (`services/flights/bookingPriceSplit.ts`):
 * shares sum to the price in the currency's minor unit, they are stored on
 * the booking and in its one currency, and a later change marks them stale.
 * What is new is who may receive a share — a flight, a stay, a cruise, a ride,
 * a rental — and the user's own amounts (`manual`), which are refused unless
 * they add up to the price exactly: a split that does not sum would either
 * lose money from the statistics or invent it.
 */
import type {
  BookingEntryKind,
  PackageSplitBody,
  StoredBookingSplit,
} from "../../schemas/flightBooking";
import { itemKey, minorDigits, splitMinorUnits, toMinorUnits } from "../flights/bookingPriceSplit";

export type PackageSplitRefusal =
  | "BOOKING_PRICE_MISSING"
  | "BOOKING_SPLIT_SINGLE_SEGMENT"
  | "BOOKING_SPLIT_ITEMS"
  | "BOOKING_SPLIT_SUM";

export interface SplitItem {
  kind: BookingEntryKind;
  id: string;
}

export function computePackageSplit(
  booking: { price: number | null; currency: string | null },
  items: readonly SplitItem[],
  body: PackageSplitBody
): { split: StoredBookingSplit } | { refusal: PackageSplitRefusal } {
  if (booking.price === null || !Number.isFinite(booking.price) || booking.price < 0) {
    return { refusal: "BOOKING_PRICE_MISSING" };
  }
  if (items.length < 2) return { refusal: "BOOKING_SPLIT_SINGLE_SEGMENT" };
  const scale = 10 ** minorDigits(booking.currency);
  const totalMinor = toMinorUnits(booking.price, scale);

  let minor: number[];
  if (body.method === "equal") {
    minor = splitMinorUnits(
      totalMinor,
      items.map(() => 1)
    );
  } else {
    // Every paying item exactly once — no more, no fewer.
    const byKey = new Map(body.shares.map((s) => [itemKey(s.kind, s.id), s.amount]));
    if (
      byKey.size !== body.shares.length ||
      byKey.size !== items.length ||
      items.some((i) => !byKey.has(itemKey(i.kind, i.id)))
    ) {
      return { refusal: "BOOKING_SPLIT_ITEMS" };
    }
    minor = items.map((i) => toMinorUnits(byKey.get(itemKey(i.kind, i.id))!, scale));
    if (minor.reduce((a, m) => a + m, 0) !== totalMinor) return { refusal: "BOOKING_SPLIT_SUM" };
  }

  return {
    split: {
      method: body.method,
      price: totalMinor / scale,
      currency: booking.currency,
      shares: items.map((item, i) => ({
        kind: item.kind,
        id: item.id,
        amount: minor[i] / scale,
        ...(item.kind === "flight" ? { flightId: item.id } : {}),
      })),
    },
  };
}

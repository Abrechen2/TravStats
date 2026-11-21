/**
 * A package booking in the statistics (forgejo#430, spec
 * docs/superpowers/specs/2026-11-21-package-bookings.md).
 *
 * A booking whose entries span more than one entry kind — a flight and a
 * hotel, a ship and a rental — is a PACKAGE. Its price was paid for all of
 * them together, so a statistic about ONE kind may not read it as that kind's
 * price: the China package (7,238 EUR) used to be reported as a 7,238 EUR
 * flight. A per-kind statistic reads the entry's share of a valid split, or
 * abstains — "part of a package", never 0 and never the whole price. The trip
 * cost (`shared/tripCost.ts`) keeps counting the package price once, which
 * is the only place the whole of it is a true answer.
 *
 * A booking of flights only is not a package: its price IS a flight price,
 * exactly as before.
 *
 * A share is valid while the booking's price and currency still match the
 * split, the split names exactly as many items as the booking holds (every
 * item, a cancelled one included — the split route makes it across all of
 * them), and it names this entry. An item added, removed or swapped makes the
 * whole package abstain again, exactly as the booking card calls it stale.
 */
import { storedBookingSplitSchema, type BookingEntryKind } from "../schemas/flightBooking";
import { isAmountRecorded } from "./flightPricing";

/** How many entries of each kind a booking sells — Prisma's `_count` on `Booking`. */
export interface BookingEntryCounts {
  flights?: number;
  cruises?: number;
  lodgingStays?: number;
  railJourneys?: number;
  busJourneys?: number;
  ferryJourneys?: number;
  rentals?: number;
}

/** The booking fields a package-aware statistic reads. */
export interface PackageAwareBooking {
  price: number | null;
  currency: string | null;
  priceBase: number | null;
  fxBaseCurrency: string | null;
  priceSplit?: unknown;
  _count?: BookingEntryCounts;
}

/** The Prisma select a package-aware cost reader puts on `booking`. */
export const PACKAGE_COST_BOOKING_SELECT = {
  price: true,
  currency: true,
  priceBase: true,
  fxBaseCurrency: true,
  priceSplit: true,
  _count: {
    select: {
      flights: true,
      cruises: true,
      lodgingStays: true,
      railJourneys: true,
      busJourneys: true,
      ferryJourneys: true,
      rentals: true,
    },
  },
} as const;

const entryTotal = (counts: BookingEntryCounts): number =>
  Object.values(counts).reduce<number>((a, n) => a + (n ?? 0), 0);

/** True when the booking sells entries of more than one kind. */
export function isPackageBooking(counts: BookingEntryCounts | undefined): boolean {
  if (!counts) return false;
  return Object.values(counts).filter((n) => (n ?? 0) > 0).length > 1;
}

/** Minor-unit scale of a currency (EUR 100, JPY 1); 100 where unknown. */
function minorScale(currency: string | null): number {
  if (!currency) return 100;
  try {
    const digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

const sameMinor = (a: number, b: number, scale: number): boolean =>
  Math.round(Number((a * scale).toPrecision(12))) ===
  Math.round(Number((b * scale).toPrecision(12)));

/** This entry's share of a valid split, or null when there is none to read. */
export function validSplitShare(
  rawSplit: unknown,
  booking: { price: number | null; currency: string | null; _count?: BookingEntryCounts },
  kind: BookingEntryKind,
  id: string
): number | null {
  if (rawSplit === null || rawSplit === undefined || booking.price === null) return null;
  const parsed = storedBookingSplitSchema.safeParse(rawSplit);
  if (!parsed.success) return null;
  const split = parsed.data;
  // The package changed since the split was made: no share is trustworthy.
  if (split.stale) return null;
  if (split.currency !== booking.currency) return null;
  if (!sameMinor(split.price, booking.price, minorScale(split.currency))) return null;
  // Membership: without the counts nothing proves the split still covers the booking.
  if (!booking._count || split.shares.length !== entryTotal(booking._count)) return null;
  const share = split.shares.find((s) => s.kind === kind && s.id === id);
  return share ? share.amount : null;
}

export interface PackageEntryShare {
  /** The entry's share in the booking currency, or null: part of an unsplit package. */
  amount: number | null;
  currency: string | null;
  /** The share in `snapshotCurrency`, through the booking's own snapshot ratio. */
  amountBase: number | null;
  snapshotCurrency: string | null;
}

/**
 * What one entry of a package costs in a per-kind statistic, or `null` when
 * the booking is no package (or holds no price) and the caller's usual rule
 * applies.
 */
export function packageEntryShare(
  booking: PackageAwareBooking | null | undefined,
  kind: BookingEntryKind,
  id: string | undefined
): PackageEntryShare | null {
  if (!booking || !id || !isAmountRecorded(booking.price)) return null;
  if (!isPackageBooking(booking._count)) return null;
  const amount = validSplitShare(booking.priceSplit, booking, kind, id);
  const ratio =
    booking.priceBase !== null && booking.price !== null && booking.price > 0
      ? booking.priceBase / booking.price
      : null;
  return {
    amount,
    currency: booking.currency,
    amountBase:
      amount === null
        ? null
        : amount === 0
          ? 0
          : ratio === null
            ? null
            : Math.round(amount * ratio * 100) / 100,
    snapshotCurrency: booking.fxBaseCurrency,
  };
}

/**
 * An entry's own price, or — when it has none and sits in a split package —
 * its share (forgejo#430). For the per-kind statistics that read the entry's
 * OWN price (lodging, cruise): they never read the booking, so a package
 * cannot leak into them whole; this only lets a split share in. An unsplit
 * package leaves the price null — unpriced, never 0.
 */
export function ownOrPackagePrice(
  own: {
    price: number | null;
    currency: string | null;
    priceBase: number | null;
    fxBaseCurrency: string | null;
  },
  booking: PackageAwareBooking | null | undefined,
  kind: BookingEntryKind,
  id: string
): {
  price: number | null;
  currency: string | null;
  priceBase: number | null;
  fxBaseCurrency: string | null;
} {
  if (isAmountRecorded(own.price)) return own;
  const pkg = packageEntryShare(booking, kind, id);
  if (!pkg || pkg.amount === null) return own;
  return {
    price: pkg.amount,
    currency: pkg.currency,
    priceBase: pkg.amountBase,
    fxBaseCurrency: pkg.amountBase === null ? null : pkg.snapshotCurrency,
  };
}

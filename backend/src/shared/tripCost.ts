/**
 * What a trip cost — the ONE server rule (forgejo#274).
 *
 * Owner rule of 2026-10-08: the server defines the calculation and the data
 * contract; web and Companion take its RESULT and add no price logic of their
 * own. Before this file the server itself held two rules. The travel account
 * (`services/stats/tripAccount.ts`) priced a flight as price + taxes + fees
 * and a shared booking once; the "most expensive trip" superlative
 * (`services/trip/tripCostSuperlative.ts`) read the bare `price`, and dropped
 * every flight that carried a `bookingId` even when that booking had no price
 * at all. A 100 + 20 + 10 EUR flight was 130 on one surface and 100 on the
 * other; on a priceless booking it was 130 and nothing; and a 130 EUR trip
 * lost "most expensive" to a 120 EUR one. Both now read the items below.
 *
 * THE RULE, per entry on the trip:
 *  - A segment (flight, cruise, stay) sold on a booking with a
 *    RECORDED price contributes that booking price — once per trip, however
 *    many segments share it, and all-in: the segments' own columns are not
 *    added on top. A booking recorded at 0 is free and does NOT fall back to
 *    the segments' prices (`shared/flightPricing.ts`).
 *  - Any other segment contributes its own cost: a flight its price + taxes +
 *    fees, the others their price. Null is unknown and abstains — it is
 *    counted in `unpricedEntries`, never summed as 0.
 *  - A booking with no segment at all (`POST /trips/bookings` can make one)
 *    costs on the trip it is attached to. A booking WITH segments costs on
 *    the trips its live segments are on, and only there: attaching it as well
 *    would bill it twice whenever its segments sit on another trip.
 *  - A cancelled segment costs nothing.
 *  - Trip expenses (forgejo#140: ferry, toll, fuel …) are their own items.
 *
 * Amounts stay in the currency they were paid in. Conversion happened on
 * WRITE (`services/fx/snapshot.ts`); a reader that needs one figure uses the
 * stored snapshot through `tripBaseTotal`, which abstains rather than assumes
 * a rate — and never treats a missing currency as the base one.
 *
 * Backend only: clients read the result (`/stats/travel-account`, `GET
 * /trips?includeInsights=true`), never a mirror of the rule.
 */
import { hasRecordedBookingPrice, isAmountRecorded, recordedOwnAmount } from "./flightPricing";

/** A price as every priced model stores it: amount, currency, FX snapshot. */
export interface StoredPrice {
  price: number | null;
  currency: string | null;
  /** The amount converted on write, in `fxBaseCurrency`. */
  priceBase: number | null;
  fxBaseCurrency: string | null;
}

/** An amount as the cost rule hands it on. `amount === null` is "nothing to add". */
export interface CostAmount {
  amount: number | null;
  currency: string | null;
  amountBase: number | null;
  snapshotCurrency: string | null;
}

export interface SegmentCostShare extends CostAmount {
  /** A price was recorded — true even when this segment's booking was added on an earlier one. */
  priced: boolean;
}

/**
 * The booking half of the rule, for any segment. `utils/stats/dedupedCost.ts`
 * `flightCostShare` delegates here, so the flight statistics and the trip
 * cost cannot drift apart again.
 *
 * `counted` is carried by the caller and mutated here: "already counted" is a
 * property of the run (one trip, one year), not of the segment.
 */
export function segmentCostShare(
  segment: { bookingId: string | null; booking: StoredPrice | null; own: CostAmount },
  counted: Set<string>
): SegmentCostShare {
  const { bookingId, booking } = segment;
  if (bookingId && booking && hasRecordedBookingPrice(booking)) {
    const first = !counted.has(bookingId);
    if (first) counted.add(bookingId);
    return {
      amount: first ? booking.price : null,
      currency: booking.currency,
      amountBase: first ? booking.priceBase : null,
      snapshotCurrency: booking.fxBaseCurrency,
      priced: true,
    };
  }
  return { ...segment.own, priced: isAmountRecorded(segment.own.amount) };
}

const ownPrice = (row: StoredPrice): CostAmount => ({
  amount: isAmountRecorded(row.price) ? row.price : null,
  currency: row.currency,
  amountBase: row.priceBase,
  snapshotCurrency: row.fxBaseCurrency,
});

interface BookedSegment {
  status: string;
  bookingId: string | null;
  booking: StoredPrice | null;
}

export interface TripCostInput {
  /**
   * Bookings ATTACHED to the trip (`Booking.tripId`), with how many segments
   * of any domain they carry anywhere. Only a segment-less one is read here;
   * the rest are reached through their segments.
   */
  bookings: (StoredPrice & { segmentCount: number })[];
  flights: (BookedSegment & StoredPrice & { taxes: number | null; fees: number | null })[];
  cruises: (BookedSegment & StoredPrice)[];
  stays: (BookedSegment & {
    totalPrice: number | null;
    currency: string | null;
    totalPriceBase: number | null;
    fxBaseCurrency: string | null;
  })[];
  expenses: { amount: number; currency: string }[];
}

export type TripCostSource = "booking" | "flight" | "cruise" | "stay" | "expense";

/** One recorded amount on a trip. `amount` is never null; 0 is a recorded free price. */
export interface TripCostItem {
  source: TripCostSource;
  amount: number;
  currency: string | null;
  amountBase: number | null;
  snapshotCurrency: string | null;
}

export interface TripCostItems {
  items: TripCostItem[];
  /** Live entries with no price recorded — on themselves or on their booking. */
  unpricedEntries: number;
}

export function tripCostItems(trip: TripCostInput): TripCostItems {
  const items: TripCostItem[] = [];
  let unpricedEntries = 0;
  // Per trip, not per run: a booking whose segments sit on two trips is a
  // real cost of both, and hiding it from the second would understate it.
  // ONE set across domains, because one booking may sell a flight and a train.
  const counted = new Set<string>();

  const take = (source: TripCostSource, share: SegmentCostShare): void => {
    if (!share.priced) unpricedEntries += 1;
    if (share.amount === null) return;
    items.push({
      source,
      amount: share.amount,
      currency: share.currency,
      amountBase: share.amountBase,
      snapshotCurrency: share.snapshotCurrency,
    });
  };
  const live = <T extends { status: string }>(rows: T[]): T[] =>
    rows.filter((row) => row.status !== "cancelled");

  for (const booking of trip.bookings) {
    if (booking.segmentCount > 0 || !isAmountRecorded(booking.price)) continue;
    take("booking", { ...ownPrice(booking), priced: true });
  }
  for (const flight of live(trip.flights)) {
    const own: CostAmount = {
      amount: recordedOwnAmount(flight),
      currency: flight.currency,
      // The flight snapshot is taken of price + taxes + fees (`fx/snapshot.ts`).
      amountBase: flight.priceBase,
      snapshotCurrency: flight.fxBaseCurrency,
    };
    take("flight", segmentCostShare({ ...flight, own }, counted));
  }
  for (const cruise of live(trip.cruises)) {
    take("cruise", segmentCostShare({ ...cruise, own: ownPrice(cruise) }, counted));
  }
  for (const stay of live(trip.stays)) {
    const own = ownPrice({
      price: stay.totalPrice,
      currency: stay.currency,
      priceBase: stay.totalPriceBase,
      fxBaseCurrency: stay.fxBaseCurrency,
    });
    take("stay", segmentCostShare({ ...stay, own }, counted));
  }
  for (const expense of trip.expenses) {
    // No FX columns on an expense (forgejo#140): a raw amount only.
    items.push({
      source: "expense",
      amount: expense.amount,
      currency: expense.currency,
      amountBase: null,
      snapshotCurrency: null,
    });
  }
  return { items, unpricedEntries };
}

function addTo(into: Record<string, number>, currency: string, amount: number): void {
  into[currency] = Math.round(((into[currency] ?? 0) + amount) * 100) / 100;
}

export interface TripSpend {
  /** Amounts by the currency they were paid in, NEVER summed across currencies. */
  spendByCurrency: Record<string, number>;
  /** The slice that carries an FX snapshot, by the base currency it was taken in. */
  spendBaseByCurrency: Record<string, number>;
  /**
   * Entries whose cost cannot be stated: no price recorded, or an amount with
   * no currency (which no bucket can hold and no rate can convert). Above 0
   * means `spendByCurrency` is a lower bound.
   */
  unpricedEntries: number;
}

export function tripSpend({ items, unpricedEntries }: TripCostItems): TripSpend {
  const spendByCurrency: Record<string, number> = {};
  const spendBaseByCurrency: Record<string, number> = {};
  let unitless = 0;
  for (const item of items) {
    // Nullish, not just null: a row that does not carry the field at all
    // yields `undefined`, which once produced a bucket keyed "undefined"
    // holding NaN (`tripAccount.ts`, before this rule moved here).
    if (item.currency == null) {
      // A unit was never recorded. It is NOT assumed to be the base currency —
      // that assumption once turned 11,662 AED into €11,662 (`dedupedCost.ts`).
      if (item.amount !== 0) unitless += 1;
      continue;
    }
    addTo(spendByCurrency, item.currency, item.amount);
    if (item.amountBase != null && item.snapshotCurrency != null) {
      addTo(spendBaseByCurrency, item.snapshotCurrency, item.amountBase);
    }
  }
  return { spendByCurrency, spendBaseByCurrency, unpricedEntries: unpricedEntries + unitless };
}

/** One item in the user's CURRENT base currency, or null when no honest conversion exists. */
function inBase(item: TripCostItem, baseCurrency: string): number | null {
  // Already in the base currency: no snapshot needed — every row written
  // before the snapshot columns existed relies on this.
  if (item.currency === baseCurrency) return item.amount;
  // A snapshot taken under a base currency the user has since left is real,
  // but real in a currency this sum is no longer computed in.
  if (item.amountBase != null && item.snapshotCurrency === baseCurrency) return item.amountBase;
  // 0 is 0 in every currency and needs no rate.
  if (item.amount === 0) return 0;
  return null;
}

export type TripBaseTotal =
  { kind: "none" } | { kind: "unconvertible" } | { kind: "total"; amount: number };

/**
 * The trip in the user's current base currency — for RANKING trips against
 * each other, never for display. `unconvertible` when any item has no honest
 * conversion: a partial sum would rank a trip on the part of it that happened
 * to convert.
 */
export function tripBaseTotal(items: TripCostItem[], baseCurrency: string): TripBaseTotal {
  if (items.length === 0) return { kind: "none" };
  let amount = 0;
  for (const item of items) {
    const converted = inBase(item, baseCurrency);
    if (converted === null) return { kind: "unconvertible" };
    amount += converted;
  }
  return { kind: "total", amount };
}

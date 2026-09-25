/**
 * Was a price RECORDED for this flight? One rule, one home.
 *
 * A price of 0 is a measurement — an award flight, a staff ticket, a leg the
 * airline comped. "Nobody wrote a price down" is `null`. Two different facts,
 * and every site that asked `if (price)` collapsed them into one.
 *
 * The 2026-09-20 product audit found the same collapse in three places at
 * once, which is why this file exists rather than three repaired conditions:
 *
 *  - `/stats/summary` reported `totalCost: null` and `unpricedFlights: 1` for
 *    a single flight explicitly saved at 0 EUR, so the overview read "no price
 *    recorded" about a price that was recorded (SRV-STATS-ZERO-PRICE-001). A
 *    mixed year of three free flights, one at 123.45 EUR and one genuinely
 *    priceless counted four unpriced flights instead of one.
 *  - The flight table rendered "k.A." for the same row while the detail page
 *    rendered "0 €" — the two screens disagreed about one stored number.
 *  - The edit modal loaded 0 and `null` into the same form state and wrote
 *    `price > 0 ? price : null` back, so changing only the seat number DELETED
 *    a valid zero price, taking `priceBase`, `fxRate` and the currency
 *    metadata with it (SRV-UI-001).
 *
 * The rule below is deliberately about PRESENCE, never about magnitude. Ask it
 * before summing, before labelling a row "unpriced", and before deciding that
 * a form field is empty.
 *
 * Mirror of backend/src/shared/flightPricing.ts - keep both in sync.
 */

/** A flight's own cost columns, as every caller happens to have them. */
export interface RecordedFlightAmounts {
  price?: number | null;
  taxes?: number | null;
  fees?: number | null;
}

/** The only part of a booking this rule reads. */
export interface RecordedBookingAmount {
  price?: number | null;
}

/**
 * True when an amount was written down. `0` is written down; `null`,
 * `undefined` and `NaN` are not.
 *
 * NaN is excluded because a form field can produce one (`parseFloat("")` on a
 * path that forgot to guard) and a NaN in a sum poisons every total it
 * touches — an unusable number is no more recorded than a missing one.
 */
export function isAmountRecorded(amount: number | null | undefined): amount is number {
  return amount != null && Number.isFinite(amount);
}

/** True when the flight carries a cost of its own — price, taxes or fees. */
export function hasRecordedOwnCost(flight: RecordedFlightAmounts): boolean {
  return (
    isAmountRecorded(flight.price) ||
    isAmountRecorded(flight.taxes) ||
    isAmountRecorded(flight.fees)
  );
}

/** True when the booking carries an amount of its own, including 0. */
export function hasRecordedBookingPrice(
  booking: RecordedBookingAmount | null | undefined
): boolean {
  return isAmountRecorded(booking?.price);
}

/**
 * The flight's own all-in amount, or `null` when nothing was recorded.
 *
 * Absent parts of a recorded cost count as 0 — a flight with a price and no
 * tax column costs its price — but a flight with no part at all abstains
 * rather than claiming to be free.
 */
export function recordedOwnAmount(flight: RecordedFlightAmounts): number | null {
  if (!hasRecordedOwnCost(flight)) return null;
  return (
    (isAmountRecorded(flight.price) ? flight.price : 0) +
    (isAmountRecorded(flight.taxes) ? flight.taxes : 0) +
    (isAmountRecorded(flight.fees) ? flight.fees : 0)
  );
}

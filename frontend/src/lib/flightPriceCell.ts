/**
 * What the price column should show for one flight.
 *
 * A flight inside a package booking has no price of its own ON PURPOSE: the
 * booking carries one all-in figure for all its segments, which is why
 * `bookingCost.ts` excludes such rows from the per-flight sum. The cell used to
 * render "k.A." for them — "not available", which says the number is unknown.
 * It is known; it simply does not belong to this row.
 *
 * A helper rather than an inline ternary so the rule can be asserted without
 * mounting the table, and so the next screen that shows a price reaches for the
 * same three states instead of inventing a fourth.
 */
import { isAmountRecorded } from "../shared/flightPricing";

export type PriceCellState = "amount" | "package" | "unknown";

export function priceCellState(flight: {
  price?: number | null;
  bookingId?: string | null;
}): PriceCellState {
  // Its own price wins even inside a booking — some import paths fill both,
  // and a figure the user can see on the row is the more specific truth.
  //
  // `isAmountRecorded`, not truthiness: the 2026-09-20 audit found the table
  // showing "k.A." for a flight the detail page showed as "0 €", because 0 is
  // falsy and "unknown" was the fall-through (SRV-UI-001). Two screens, one
  // stored number, two answers.
  if (isAmountRecorded(flight.price)) return "amount";
  if (flight.bookingId) return "package";
  return "unknown";
}

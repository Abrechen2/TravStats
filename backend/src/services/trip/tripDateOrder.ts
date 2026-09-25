import { AppError } from "../../middleware/errorHandler";
import { TRIP_DATE_ORDER_MESSAGE, tripDatesInOrder } from "../../schemas/trip";

/**
 * A PATCH has to be judged on the span it LEAVES BEHIND, not on the dates it
 * happens to carry.
 *
 * The Zod schema sees only the body, so a patch that moves the end date alone
 * had nothing to compare it with. The 2026-09-20 audit saved a trip running
 * 10.08.2025 to 01.08.2025 through the real web form and got a 200
 * (SRV-TRIP-DATE-001); Web and Companion then both drew "10. – 1. August".
 * The same shape of hole was closed for flight times in
 * `services/flights/mergedChronology.ts` (AUD-018) and this is its trip
 * counterpart.
 *
 * Its own module, and pure, so the merge semantics can be asserted without a
 * database: `undefined` means the field was not sent and the stored value
 * stands, while an explicit `null` clears it and leaves the span unjudgeable.
 */

export interface TripDatePatch {
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface StoredTripDates {
  startDate: Date | null;
  endDate: Date | null;
}

/** The span the update would leave in the database. */
export function mergedTripDates(patch: TripDatePatch, existing: StoredTripDates): StoredTripDates {
  return {
    startDate: patch.startDate !== undefined ? patch.startDate : existing.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : existing.endDate,
  };
}

/** Throw 400 when the update's RESULT would end before it starts. */
export function assertMergedTripDates(patch: TripDatePatch, existing: StoredTripDates): void {
  const merged = mergedTripDates(patch, existing);
  if (!tripDatesInOrder(merged.startDate, merged.endDate)) {
    throw new AppError(TRIP_DATE_ORDER_MESSAGE, 400);
  }
}

import type { Trip } from "../types";

/** The only fields the rule reads — a test or a caller need not build a whole Trip. */
export type DatedTrip = Pick<Trip, "id" | "startDate" | "endDate">;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** The calendar day of a date input value or an ISO timestamp, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = ISO_DAY.exec(value);
  return match ? match[0] : null;
}

/**
 * Does this trip's date range contain `day`? Both ends are inclusive: a flight
 * home on the last day of a trip belongs to it.
 *
 * A trip with no start date covers nothing — there is nowhere to place it. A
 * trip with a start but no end is open-ended (still running, or its end never
 * written down) and covers every day from its start on; with the exactly-one
 * rule in `tripIdForDate`, a later trip that does have a range simply makes the
 * answer ambiguous rather than wrong.
 */
export function tripCoversDate(trip: DatedTrip, day: string): boolean {
  const target = dayOf(day);
  const start = dayOf(trip.startDate);
  if (!target || !start) return false;
  const end = dayOf(trip.endDate);
  return target >= start && (end === null || target <= end);
}

export function tripsContainingDate<T extends DatedTrip>(trips: readonly T[], day: string): T[] {
  return trips.filter((trip) => tripCoversDate(trip, day));
}

/**
 * The trip a new entry dated `day` belongs to — but only when exactly one trip
 * covers that day. Two overlapping trips, or none, is an abstention: a guessed
 * trip the user has to notice and undo is worse than an empty select.
 */
export function tripIdForDate(trips: readonly DatedTrip[], day: string): string | null {
  const matches = tripsContainingDate(trips, day);
  return matches.length === 1 ? matches[0].id : null;
}

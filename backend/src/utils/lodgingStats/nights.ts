/**
 * Night allocation, shared by every figure that counts nights.
 *
 * A "night" belongs to the calendar date it STARTS on; the check-out day
 * itself contributes no night. Dates are walked in UTC — `checkIn`/`checkOut`
 * arrive as `Date` objects normalized to UTC midnight, so stepping via
 * `Date.UTC(...)` day-by-day is immune to local-timezone shifts and DST
 * boundaries. No local-time arithmetic ever divides a day into fractional
 * hours that could round into the wrong bucket.
 */

/**
 * Walks each night of a stay into `nightsByYear`/`nightsByMonth`, mutating both
 * accumulators in place (private helpers of the caller, never the public
 * input) and returning how many nights it walked.
 *
 * Pass throwaway `{}` accumulators to count nights without bucketing them —
 * that is how planned nights are totalled without appearing in the series of
 * nights actually slept.
 */
export function walkNights(
  checkIn: Date,
  checkOut: Date,
  nightsByYear: Record<string, number>,
  nightsByMonth: Record<string, number>,
): number {
  let nights = 0;
  let cursor = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const end = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());

  while (cursor < end) {
    const d = new Date(cursor);
    const year = String(d.getUTCFullYear());
    const month = `${year}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    nightsByYear[year] = (nightsByYear[year] ?? 0) + 1;
    nightsByMonth[month] = (nightsByMonth[month] ?? 0) + 1;
    nights += 1;
    cursor += 24 * 60 * 60 * 1000;
  }

  return nights;
}

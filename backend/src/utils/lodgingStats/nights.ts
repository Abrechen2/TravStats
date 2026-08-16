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

/**
 * Nights for a stay whose dates cannot be walked day by day — an undated stay,
 * a one-ended one, or one recorded only to the month or the year.
 *
 * The nights still count toward totals (a hotel you cannot date is still one
 * you slept in), but they enter only the series the precision can honestly
 * support: a MONTH-precision stay reaches the month bucket, a YEAR-precision
 * one only the year, and an undated one neither. Putting them all on their
 * anchor date would place "some time in 2011" on 1 January, where it is
 * indistinguishable from a stay that really started there.
 *
 * Mutates the accumulators in place and returns the night count, mirroring
 * `walkNights` so the caller can use either without a second shape.
 */
export function bucketNights(
  timing: {
    nights: number;
    anchor: Date | null;
    canBucketByYear: boolean;
    canBucketByMonth: boolean;
  },
  nightsByYear: Record<string, number>,
  nightsByMonth: Record<string, number>,
): number {
  const { nights, anchor } = timing;
  if (nights <= 0 || anchor === null) return Math.max(0, nights);

  if (timing.canBucketByYear) {
    const year = String(anchor.getUTCFullYear());
    nightsByYear[year] = (nightsByYear[year] ?? 0) + nights;
    if (timing.canBucketByMonth) {
      const month = `${year}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`;
      nightsByMonth[month] = (nightsByMonth[month] ?? 0) + nights;
    }
  }
  return nights;
}

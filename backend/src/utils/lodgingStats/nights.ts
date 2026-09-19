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

// Mirrors MAX_STAY_SPAN_NIGHTS in schemas/lodging.ts (~10 years). That schema
// now refuses a checkIn/checkOut span wider than this at the API boundary,
// but a row already in the database can predate the validation — a stay
// saved before this cap existed (or written directly to the DB) can still
// carry checkIn="0001-01-01" / checkOut="9999-12-31". Found by an
// independent Codex review (2026-09-17): without a bound HERE too, that row
// alone made every later lodging-statistics request loop ~3.6 million times
// and build ~3.6M-entry `nightsByYear`/`nightsByMonth` maps, serialised
// whole into the response.
const MAX_WALK_NIGHTS = 3650;

/**
 * Walks each night of a stay into `nightsByYear`/`nightsByMonth`, mutating both
 * accumulators in place (private helpers of the caller, never the public
 * input) and returning how many nights it walked.
 *
 * Pass throwaway `{}` accumulators to count nights without bucketing them —
 * that is how planned nights are totalled without appearing in the series of
 * nights actually slept.
 *
 * Contract for a span wider than `MAX_WALK_NIGHTS`: the walk stops at the
 * cap. The caller gets the nights counted UP TO the cap (not the true full
 * span, and not zero/an abstention) and `nightsByYear`/`nightsByMonth` carry
 * only that same bounded prefix. This is a defensive floor for data that
 * predates the schema's own span cap, not a legitimate value a valid stay is
 * expected to hit — `nightsKnown`/abstention semantics upstream
 * (shared/lodgingTiming.ts) are for "we don't know", which is a different
 * case from "we know, and it is very large".
 */
export function walkNights(
  checkIn: Date,
  checkOut: Date,
  nightsByYear: Record<string, number>,
  nightsByMonth: Record<string, number>
): number {
  let nights = 0;
  let cursor = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const end = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());

  while (cursor < end && nights < MAX_WALK_NIGHTS) {
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
  nightsByMonth: Record<string, number>
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

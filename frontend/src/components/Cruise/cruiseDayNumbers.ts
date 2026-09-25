import type { CruiseStopInput } from "../../types";

/**
 * The day of the cruise each stop falls on, after an edit in the stops editor.
 *
 * `dayNumber` is the day of the cruise, not a list position (owner, 19.09.2026,
 * forgejo#126). Renumbering to `index + 1` turned a 7-night cruise's
 * disembarkation on day 8 into day 2 the moment anything was touched, even an
 * excursion note, and into day 3 after adding one sea day.
 *
 * The rule, the same as the Companion's route editor (`dayNumbers()` in
 * `app/src/lib/cruise-route/draft.ts`): a stop keeps the day it was loaded
 * with; a stop added in the editor takes the day after the one before it; and
 * a stop whose day would no longer rise, because it was moved behind a later
 * day, is pushed to the next free day.
 *
 *   [1, 8] untouched -> [1, 8]; a sea day added between -> [1, 2, 8];
 *   the middle of [1, 4, 8] removed -> [1, 8]; day 8 moved above day 4 -> [1, 8, 9].
 */
export function withCruiseDayNumbers(stops: readonly CruiseStopInput[]): CruiseStopInput[] {
  let previous = 0;
  return stops.map((stop) => {
    const originalDay = stop.originalDay === undefined ? stop.dayNumber : stop.originalDay;
    const dayNumber = Math.max(originalDay ?? previous + 1, previous + 1);
    previous = dayNumber;
    return { ...stop, originalDay, dayNumber };
  });
}

/** "2026-01-01" + 7 days -> "2026-01-08", in UTC so no timezone can shift the day. */
function addDays(isoDate: string, days: number): string | null {
  const start = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(start)) return null;
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The calendar date of each stop, derived from the cruise's start date and the
 * stop's day of the cruise: day 1 is the start date, day 8 a week later.
 *
 * A date the user typed, or one the stop was loaded with, is never touched —
 * only an EMPTY date is filled, and a date this function filled keeps following
 * the day (a stop moved behind a later day moves its date with it) until the
 * user edits it. Without a start date there is nothing to derive from, so a
 * derived date is taken back rather than left pointing at a start that is gone.
 *
 * Returns the input array itself when nothing changed, so a caller can run it
 * from an effect without looping.
 */
export function withDerivedStopDates(
  stops: CruiseStopInput[],
  startDate: string
): CruiseStopInput[] {
  let changed = false;
  const next = stops.map((stop) => {
    if (stop.dateSource === "user") return stop;
    const derivable = stop.dateSource === "derived" || !stop.date;
    if (!derivable) return stop;
    const day = startDate ? addDays(startDate, stop.dayNumber - 1) : null;
    const date = day ? `${day}T00:00:00.000Z` : null;
    const dateSource = day ? ("derived" as const) : undefined;
    if (stop.date === date && stop.dateSource === dateSource) return stop;
    if (!stop.date && !date) return stop;
    changed = true;
    return { ...stop, date, dateSource };
  });
  return changed ? next : stops;
}

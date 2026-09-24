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

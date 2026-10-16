const MS_PER_DAY = 86_400_000;

/** A `YYYY-MM-DD` (or ISO date-time) as a UTC day count, or null. */
function dayIndex(date: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / MS_PER_DAY);
}

/**
 * The day of the cruise for each imported stop, in list order (CLAUDE.md:
 * `dayNumber` is the day of the cruise, not a list position). Numbered by
 * position, a booking that leaves the sea days out called the port on day 3
 * "day 2", and a later re-read of the same booking against the stored
 * itinerary saw every port after it as removed and added again.
 *
 * A dated stop takes `date − startDate + 1`; an undated one, or one whose
 * date would fall before the previous stop's day (a misread date), takes the
 * day after the previous stop. Two calls on one date share the day.
 */
export function importDayNumbers(
  dates: ReadonlyArray<string | null | undefined>,
  startDate: string | null | undefined
): number[] {
  const start = dayIndex(startDate);
  let previous = 0;
  return dates.map((date) => {
    const index = dayIndex(date);
    const derived = start !== null && index !== null ? index - start + 1 : null;
    const day = derived !== null && derived >= Math.max(previous, 1) ? derived : previous + 1;
    previous = day;
    return day;
  });
}

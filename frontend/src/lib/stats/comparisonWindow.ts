/**
 * Which span a year-over-year comparison is allowed to measure — one home.
 *
 * The statistics page sets the selected year against another one. For a year
 * that is STILL RUNNING that compared eight months against twelve: the demo
 * account read "-29 Erlebnisse (-78 %)" in September, which looks like a
 * collapse in travel and is really a difference in elapsed time. The same
 * figure would have read "+0 %" on 31 December having moved by nothing in
 * between, which is the tell — a delta that is a function of the calendar
 * rather than of the data.
 *
 * So a running year is compared against the same span of the other year:
 * 1 January to today, versus 1 January to the same day there. A year that is
 * OVER keeps the full-year comparison it always had.
 *
 * The cut is "is this year still running", NOT "is this the year on the system
 * clock": a reader looking at 2024 in 2026 gets a full-year comparison,
 * because 2024 is over and nothing about it is still accruing.
 *
 * `today` is a parameter, never `Date.now()` read inside, so a test can pin
 * September. Everything here works in LOCAL calendar parts, because the day
 * keys it is compared against are wall-clock dates each domain already decided
 * (a flight's departure airport, a stay's UTC check-in) — re-reading them as
 * instants here would apply a fifth clock to four domains that each chose one.
 */
import { crossDomainDayKey, dayKeyInYear } from "../../shared/crossDomainCounting";

export type ComparisonKind = "fullYear" | "samePeriod";

export interface ComparisonWindow {
  kind: ComparisonKind;
  /** Inclusive last day the selected year may count. */
  currentEnd: Date;
  /** The same window one year earlier — what the default compare year uses. */
  previousEnd: Date;
}

/**
 * The window for a selected year, as of `today`.
 *
 * `previousEnd` answers the default comparison (`selectedYear - 1`). The
 * compare year is the reader's pick and survives a revisit (#188), so it is
 * not always the year before — `windowEndInYear` is what a caller with an
 * arbitrary compare year asks.
 */
export function comparisonWindow(selectedYear: number, today: Date = new Date()): ComparisonWindow {
  if (selectedYear < today.getFullYear()) {
    return {
      kind: "fullYear",
      currentEnd: lastDayOfYear(selectedYear),
      previousEnd: lastDayOfYear(selectedYear - 1),
    };
  }
  const month = today.getMonth();
  const day = today.getDate();
  return {
    kind: "samePeriod",
    currentEnd: sameDayIn(selectedYear, month, day),
    previousEnd: sameDayIn(selectedYear - 1, month, day),
  };
}

/** Where this window ends inside an arbitrary year — the compare year included. */
export function windowEndInYear(window: ComparisonWindow, year: number): Date {
  if (window.kind === "fullYear") return lastDayOfYear(year);
  return sameDayIn(year, window.currentEnd.getMonth(), window.currentEnd.getDate());
}

/**
 * The same end as a `YYYY-MM-DD` key, so a caller can compare it against the
 * day keys the domain adapters emit without parsing either side back into a
 * Date. ISO day keys sort lexicographically, which is why `<=` is enough.
 */
export function windowEndKeyInYear(window: ComparisonWindow, year: number): string {
  const end = windowEndInYear(window, year);
  return crossDomainDayKey(end.getFullYear(), end.getMonth() + 1, end.getDate());
}

/**
 * A predicate over `YYYY-MM-DD` keys: inside `year`, and on or before where
 * this window ends there. The end key is resolved ONCE — a per-day
 * `windowEndInYear` would build a Date for every day of every domain.
 *
 * A full-year window ends on 31 December, so the predicate is then exactly the
 * year test the fold already used and nothing about a completed year moves.
 */
export function windowFilter(
  year: number | null,
  window: ComparisonWindow | null
): (dayKey: string) => boolean {
  const endKey =
    year !== null && window !== null && window.kind === "samePeriod"
      ? windowEndKeyInYear(window, year)
      : null;
  return (dayKey: string): boolean =>
    dayKeyInYear(dayKey, year) && (endKey === null || dayKey <= endKey);
}

/**
 * How many events a domain counts in `year` within this window — the one home
 * for that arithmetic, called by the cross-domain fold and by the per-domain
 * card so the card can never contradict the strip above it.
 *
 * A completed year takes the `yearlyEvents` tally untouched rather than
 * re-adding the days. `dailyEvents` sums to it by construction, but making the
 * unchanged case take the unchanged path means "a full-year comparison is
 * exactly what it was" is a property of this code, not an invariant between
 * two indexes that someone has to keep true.
 */
export function eventsInWindow(
  stats: { dailyEvents: Record<string, number>; yearlyEvents: Record<number, number> },
  year: number,
  window: ComparisonWindow | null
): number {
  if (window === null || window.kind === "fullYear") return stats.yearlyEvents[year] ?? 0;
  const within = windowFilter(year, window);
  let sum = 0;
  for (const [dayKey, count] of Object.entries(stats.dailyEvents)) {
    if (within(dayKey)) sum += count;
  }
  return sum;
}

function lastDayOfYear(year: number): Date {
  return new Date(year, 11, 31);
}

function sameDayIn(year: number, month0: number, day: number): Date {
  // 29 February has no counterpart in a common year. `new Date(2025, 1, 29)`
  // rolls forward to 1 March, which would push the window a day PAST the one
  // the reader is standing on and silently count a 1 March event into a window
  // that is supposed to end on 29 February. Clamp to the last day of the month
  // — 28 February — instead.
  const lastOfMonth = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(day, lastOfMonth));
}

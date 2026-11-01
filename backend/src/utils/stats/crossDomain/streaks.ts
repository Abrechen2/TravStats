/**
 * "Days on the road" streaks across every domain (forgejo#399).
 *
 * The input is the UNION of the active day keys the cross-domain KPI strip
 * already counts (`crossDomainActiveDayCount`): a flight, a hotel night, a
 * train ride and a place visit on one day are one active day. Nothing is
 * summed across domains here — the only cross-domain figure the design
 * charter allows is days travelling, and a streak is a run of exactly those.
 *
 * Abstention: no active day means no streak at all (`null`, not 0). The
 * CURRENT streak is `null` as well when no run reaches today or yesterday —
 * "nothing is running" is not a streak of length zero. Yesterday counts as
 * still running because today may simply not be logged yet.
 *
 * Pure: day keys in, numbers out. Days after `today` are ignored — a booked
 * trip ahead is not a streak.
 */
import { daysBetween } from "../../../shared/time/localDate";

export interface DayRun {
  /** Length of the run in days. */
  days: number;
  from: string;
  to: string;
}

export interface MonthRun {
  /** Calendar months in a row with at least one active day. */
  months: number;
  /** `YYYY-MM` of the first and last month of the run. */
  from: string;
  to: string;
}

export interface CrossDomainStreaks {
  activeDays: number;
  longestDayStreak: DayRun | null;
  currentDayStreak: DayRun | null;
  longestMonthStreak: MonthRun | null;
  currentMonthStreak: MonthRun | null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Maximal runs of consecutive items; `step(a, b)` is true when b directly follows a. */
function runs<T>(sorted: readonly T[], follows: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && follows(last[last.length - 1], item)) last.push(item);
    else out.push([item]);
  }
  return out;
}

export function computeStreaks(
  dayKeys: readonly string[],
  today: string
): CrossDomainStreaks | null {
  const days = [...new Set(dayKeys.filter((d) => DAY_KEY.test(d) && d <= today))].sort();
  if (days.length === 0) return null;

  const dayRuns = runs(days, (a, b) => daysBetween(a, b) === 1);
  const toDayRun = (r: string[]): DayRun => ({ days: r.length, from: r[0], to: r[r.length - 1] });
  // Ties go to the later run: "the longest, most recently".
  const longest = dayRuns.reduce((best, r) => (r.length >= best.length ? r : best));
  const live = dayRuns.find(
    (r) => r[r.length - 1] === today || r[r.length - 1] === previousDay(today)
  );

  const months = [...new Set(days.map((d) => d.slice(0, 7)))].sort();
  const monthRuns = runs(months, (a, b) => monthIndex(b) - monthIndex(a) === 1);
  const toMonthRun = (r: string[]): MonthRun => ({
    months: r.length,
    from: r[0],
    to: r[r.length - 1],
  });
  const longestMonths = monthRuns.reduce((best, r) => (r.length >= best.length ? r : best));
  const thisMonth = today.slice(0, 7);
  // Like "yesterday" for days: a run that ended last month is still running.
  const liveMonths = [...monthRuns]
    .reverse()
    .find((r) => monthIndex(thisMonth) - monthIndex(r[r.length - 1]) <= 1);

  return {
    activeDays: days.length,
    longestDayStreak: toDayRun(longest),
    currentDayStreak: live ? toDayRun(live) : null,
    longestMonthStreak: toMonthRun(longestMonths),
    currentMonthStreak: liveMonths ? toMonthRun(liveMonths) : null,
  };
}

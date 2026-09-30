/**
 * Calendar arithmetic on `YYYY-MM-DD` days — WEB-ONLY, zone-free.
 *
 * A calendar grid (a month view, a year heatmap) steps through DAYS, not
 * instants. Doing that with `new Date(y, m, d)` and `setDate()` builds every
 * cell in the HOST's zone, so the grid and the flights placed on it were read
 * on the reader's clock (ADR 0002, D6). Here a day is a string, and every
 * step is `Date.UTC` + `getUTC*` on it, where no zone and no DST can intrude.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86_400_000;

/** The day with `year`, `month` (1-12) and `day`, normalised like Date.UTC (month 13 = next January). */
export function dayString(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function utcMs(day: string): number {
  const m = DAY.exec(day);
  if (!m) throw new RangeError(`Not a day: ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `{ year, month (1-12), day }` of a `YYYY-MM-DD…` string. */
export function dayParts(day: string): { year: number; month: number; day: number } {
  const date = new Date(utcMs(day));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** `day` moved by `n` calendar days. */
export function addDays(day: string, n: number): string {
  return new Date(utcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday — the weekday that calendar day falls on anywhere. */
export function weekdayOf(day: string): number {
  return new Date(utcMs(day)).getUTCDay();
}

/** Days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** Number of days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A day in words in the reader's language ("Samstag, 1. August 2026"),
 * built on UTC so the reader's zone cannot move it.
 */
export function formatDayLong(
  day: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(utcMs(day))
  );
}

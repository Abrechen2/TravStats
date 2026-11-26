import { addDays, dayParts, dayString, daysInMonth, weekdayOf } from "../../shared/time/calendar";

/**
 * The pure half of the date fields: typed text in the profile's date format to
 * a real calendar day and back, the clock the same way, and the month grid.
 *
 * Typed entry is VALIDATED, never normalised: `new Date(2026, 1, 31)` rolls
 * over to 3 March, and a field that quietly stored 3 March for "31.02.2026"
 * would be a wrong date nobody typed. A day that does not exist is `null`.
 */

export type DateFormatId = "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

/** Whether year/month/day name a day that exists (leap years included). */
export function isRealDay(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  return Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month);
}

const WIRE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` that names a real day, else false. */
export function isWireDay(value: string): boolean {
  const m = WIRE_DAY.exec(value);
  return m !== null && isRealDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** The wire day as the reader's format writes it ("26.11.2026"); "" when not a day. */
export function showDay(day: string, format: DateFormatId): string {
  const m = WIRE_DAY.exec(day);
  if (!m || !isWireDay(day)) return "";
  const [, y, mo, d] = m;
  if (format === "MM/DD/YYYY") return `${mo}/${d}/${y}`;
  if (format === "YYYY-MM-DD") return `${y}-${mo}-${d}`;
  return `${d}.${mo}.${y}`;
}

export type TypedDay = { kind: "empty" } | { kind: "day"; day: string } | { kind: "invalid" };

const SEPARATORS = /[./-]/;

/**
 * Typed text to a wire day, in the reader's order. Accepts the separators of
 * any format (`.`, `/`, `-`) because people type what they are used to, and
 * a two-digit day or month without its leading zero. A two-digit year is
 * refused: "26" is 1926 or 2026, and guessing is how a birthday moves a century.
 */
export function readTypedDay(text: string, format: DateFormatId): TypedDay {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  // The wire form is unambiguous in any reader's format, so it is always
  // accepted (a pasted "2026-10-02" is not read as year 10, month 2).
  if (WIRE_DAY.test(trimmed))
    return isWireDay(trimmed) ? { kind: "day", day: trimmed } : { kind: "invalid" };
  const parts = trimmed.split(SEPARATORS);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return { kind: "invalid" };
  const [a, b, c] = parts;
  let year: string;
  let month: string;
  let day: string;
  if (format === "YYYY-MM-DD") [year, month, day] = [a, b, c];
  else if (format === "MM/DD/YYYY") [month, day, year] = [a, b, c];
  else [day, month, year] = [a, b, c];
  if (year.length !== 4 || month.length > 2 || day.length > 2) return { kind: "invalid" };
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  return isRealDay(y, m, d) ? { kind: "day", day: dayString(y, m, d) } : { kind: "invalid" };
}

export type TimeFormatId = "24h" | "12h";

/** `HH:mm` (the wire time, optionally with seconds) as the reader's clock writes it. */
export function showClock(time: string, format: TimeFormatId): string {
  const m = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  if (!m) return "";
  const h = Number(m[1]);
  const min = m[2];
  if (h > 23 || Number(min) > 59) return "";
  if (format === "24h") return `${m[1]}:${min}`;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${suffix}`;
}

export type TypedClock = { kind: "empty" } | { kind: "time"; time: string } | { kind: "invalid" };

/** Typed clock ("14:05", "14.05", "2:05 PM", "1405") to a wire `HH:mm`. */
export function readTypedClock(text: string): TypedClock {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*([AaPp][Mm])?$/.exec(trimmed);
  if (!m) return { kind: "invalid" };
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (m[3]) {
    if (hour < 1 || hour > 12) return { kind: "invalid" };
    const pm = m[3].toLowerCase() === "pm";
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return { kind: "invalid" };
  return {
    kind: "time",
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export interface MonthCell {
  day: string;
  inMonth: boolean;
}

/**
 * The cells of a month, whole weeks, `weekStart` 1 = Monday (the German
 * calendar) or 0 = Sunday (the US one). Always 6 rows, so the popover does not
 * change height as the month changes.
 */
export function monthCells(year: number, month: number, weekStart: 0 | 1): MonthCell[] {
  const first = dayString(year, month, 1);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => {
    const day = addDays(start, i);
    return { day, inMonth: dayParts(day).month === month };
  });
}

/** The 3-letter-ish weekday names starting at `weekStart` come from Intl; this gives the dates to name. */
export function weekdayDays(weekStart: 0 | 1): string[] {
  // 2024-01-07 is a Sunday, 2024-01-01 a Monday.
  const base = weekStart === 1 ? "2024-01-01" : "2023-12-31";
  return Array.from({ length: 7 }, (_, i) => addDays(base, i));
}

/** Wire day `a` is not before `b` (`YYYY-MM-DD` sorts as dates do). */
export const dayNotBefore = (a: string, b: string): boolean => a >= b;

const WIRE_MONTH = /^(\d{4})-(\d{2})$/;

/** `YYYY-MM` as the reader's format writes a month ("11.2026", "11/2026", "2026-11"). */
export function showMonth(month: string, format: DateFormatId): string {
  const m = WIRE_MONTH.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "";
  if (format === "MM/DD/YYYY") return `${m[2]}/${m[1]}`;
  if (format === "YYYY-MM-DD") return `${m[1]}-${m[2]}`;
  return `${m[2]}.${m[1]}`;
}

export type TypedMonth = { kind: "empty" } | { kind: "month"; month: string } | { kind: "invalid" };

/** Typed month ("11.2026", "11/2026", "2026-11") to a wire `YYYY-MM`. */
export function readTypedMonth(text: string): TypedMonth {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const parts = trimmed.split(SEPARATORS);
  if (parts.length !== 2 || parts.some((p) => !/^\d+$/.test(p))) return { kind: "invalid" };
  const yearFirst = parts[0].length === 4;
  const [year, month] = yearFirst ? [parts[0], parts[1]] : [parts[1], parts[0]];
  if (year.length !== 4 || month.length > 2) return { kind: "invalid" };
  if (!isRealDay(Number(year), Number(month), 1)) return { kind: "invalid" };
  return { kind: "month", month: `${year}-${month.padStart(2, "0")}` };
}

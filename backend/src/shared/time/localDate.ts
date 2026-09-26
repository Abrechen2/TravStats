import { InvalidLocalTimeError } from "./errors";
import { partsToUtcMs } from "./zonedParts";

/**
 * Calendar days at the data layer (ADR 0002 D1): a `DATE` never crosses a
 * code boundary as a JS `Date`.
 *
 * Prisma hands a `@db.Date` column back as a `Date` at UTC midnight. Every
 * host-local getter on it (`getDate()`, `toLocaleDateString()`, date-fns
 * `format`) shifts the day for a host west of UTC — the birthday of a user in
 * New York would print a day early. So the data layer converts on read and
 * write, and everything above it handles `"YYYY-MM-DD"` strings, which have
 * no zone to be misread in.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** True for a real calendar date written `YYYY-MM-DD` (2027-02-29 is not one). */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(partsToUtcMs({ year, month, day, hour: 0, minute: 0, second: 0 }));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day
  );
}

/**
 * The day a `@db.Date` value holds. Refuses a `Date` that is not UTC midnight:
 * that is a DATE parsed as a HOST-local midnight somewhere below, and reading
 * its UTC date would report the neighbouring day without a sound. The
 * Phase 1 probe (`__tests__/dbDate.probe.test.ts`) pins that the driver does
 * not do this today; this refusal is what catches it if it ever starts.
 */
export function fromDbDate(value: Date): string {
  const ms = value.getTime();
  if (!Number.isFinite(ms)) throw new InvalidLocalTimeError(String(value));
  if (ms % 86_400_000 !== 0) {
    throw new InvalidLocalTimeError(`${value.toISOString()} is not a UTC-midnight DATE`);
  }
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** The `Date` Prisma writes to a `@db.Date` column for a `YYYY-MM-DD` day. */
export function toDbDate(day: string): Date {
  if (!isLocalDate(day)) throw new InvalidLocalTimeError(day);
  const [year, month, date] = day.split("-").map(Number);
  return new Date(partsToUtcMs({ year, month, day: date, hour: 0, minute: 0, second: 0 }));
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}

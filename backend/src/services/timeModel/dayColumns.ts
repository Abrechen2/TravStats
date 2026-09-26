import { toDbDate } from "../../shared/time/localDate";

/**
 * Calendar-day columns in phase 2 (ADR 0002 D1): the legacy `DateTime`
 * columns hold a day as UTC midnight (sometimes noon, written by the cruise
 * import), and the new `DATE` columns hold the same day. Every writer derives
 * the second from the first here, so the two cannot name different days.
 */

/** The `@db.Date` value for the day a legacy day anchor names (its UTC date). */
export function dbDayOf(anchor: Date): Date {
  return toDbDate(anchor.toISOString().slice(0, 10));
}

/** `dbDayOf` that passes null through. */
export function dbDayOrNull(anchor: Date | null | undefined): Date | null {
  return anchor ? dbDayOf(anchor) : null;
}

/**
 * The new day columns for a PATCH-style write: a key that was not sent
 * (`undefined`) stays out of the result, so an update never clears a day it
 * did not touch.
 */
export function dayPatch<K extends string>(
  key: K,
  anchor: Date | string | null | undefined
): Partial<Record<K, Date | null>> {
  if (anchor === undefined) return {};
  const value = anchor === null ? null : dbDayOf(new Date(anchor));
  return { [key]: value } as Partial<Record<K, Date | null>>;
}

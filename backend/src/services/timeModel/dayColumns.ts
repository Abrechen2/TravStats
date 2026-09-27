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
 * A day an UPDATE sent, as the legacy anchor to store: the stored anchor when
 * it already names that day. Day inputs now arrive as UTC midnight, while
 * older rows (the cruise import wrote noon) hold another hour of the same day;
 * rewriting that hour would read as "the date changed" to every comparison
 * that keys on the anchor — the FX snapshot re-ran on a cabin-only edit and,
 * with the lookup down, kept its old rate while reporting a change (defect
 * class 4: a re-derivation must not act on data that did not move).
 */
export function keepStoredDay(
  sent: Date | null | undefined,
  stored: Date | null
): Date | null | undefined {
  if (!sent || !stored) return sent;
  return sent.toISOString().slice(0, 10) === stored.toISOString().slice(0, 10) ? stored : sent;
}

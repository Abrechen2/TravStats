import { fromDbDate, toDbDate } from "../../shared/time/localDate";
import type { LocalDateValue, TimeValue } from "../../shared/time/wire";
import type { EventBounds } from "./ics";

/**
 * From an entry's `times` (ADR 0002 D3) to the bounds of a calendar event.
 *
 * Every domain already answers its times as `TimeValue`s (an instant at a
 * place) or `LocalDateValue`s (a day at a place); the feed reads those and
 * nothing else, so a flight's fake-UTC legacy row or a stay's legacy day anchor
 * is read by the same code that reads it for the web and the Companion.
 *
 * - An instant known to the minute goes out as itself, in UTC — a calendar app
 *   shows it on the reader's own clock, which is what a calendar is for.
 * - A ride logged by day only (`precision: "day"`) and every day value becomes
 *   an all-day event on the PLACE's calendar day, never the UTC date.
 * - Anything vaguer (`month`, `year`, `unknown`) is left out. A stay "some time
 *   in July 2011" has no day a calendar could put it on, and drawing it on the
 *   1st would be the placeholder passed off as a date.
 */

const DAY_MS = 86_400_000;

/** The calendar day `n` days after `day`. */
export function addDays(day: string, n: number): string {
  return fromDbDate(new Date(toDbDate(day).getTime() + n * DAY_MS));
}

const later = (a: string, b: string): string => (a > b ? a : b);

/** The place's calendar day of a TimeValue that is known at least to the day. */
const dayOf = (value: TimeValue): string => value.local.slice(0, 10);

const knownToDay = (value: TimeValue | null): value is TimeValue =>
  value !== null && (value.precision === "minute" || value.precision === "day");

/**
 * A journey between two instants — a flight, a train, a ferry, a rental.
 * Null when the start is not known to the day.
 */
export function boundsOfInstants(
  start: TimeValue | null,
  end: TimeValue | null
): EventBounds | null {
  if (!knownToDay(start)) return null;
  if (start.precision === "minute") {
    const from = new Date(start.utc);
    // An end only when it is a real later instant: a date-only arrival on a
    // timed departure says nothing about when the event ends.
    const to =
      end && end.precision === "minute" && new Date(end.utc) > from ? new Date(end.utc) : null;
    return { kind: "timed", start: from, end: to };
  }
  const first = dayOf(start);
  const last = knownToDay(end) ? later(dayOf(end), first) : first;
  return { kind: "allDay", start: first, endExclusive: addDays(last, 1) };
}

const dayKnown = (value: LocalDateValue | null): value is LocalDateValue =>
  value !== null && value.precision === "day";

/**
 * A span of days the entry covers INCLUSIVELY — a cruise, a trip, a roadtrip
 * station: the last day is one the traveller is still there.
 */
export function boundsOfDaySpan(
  start: LocalDateValue | null,
  end: LocalDateValue | null
): EventBounds | null {
  if (!dayKnown(start)) return null;
  const last = dayKnown(end) ? later(end.date, start.date) : start.date;
  return { kind: "allDay", start: start.date, endExclusive: addDays(last, 1) };
}

/**
 * A hotel stay by its days: from check-in to check-out, the check-out day
 * EXCLUDED — the nights, which is how hotels and booking sites put a stay in a
 * calendar. A same-day stay (or one without a check-out) keeps its one day.
 */
export function boundsOfNights(
  checkIn: LocalDateValue | null,
  checkOut: LocalDateValue | null
): EventBounds | null {
  if (!dayKnown(checkIn)) return null;
  const end =
    dayKnown(checkOut) && checkOut.date > checkIn.date ? checkOut.date : addDays(checkIn.date, 1);
  return { kind: "allDay", start: checkIn.date, endExclusive: end };
}

/** The last instant an event touches, for the look-back window. */
export function endOfBounds(bounds: EventBounds): Date {
  if (bounds.kind === "timed") return bounds.end ?? bounds.start;
  // The exclusive end day at UTC midnight. The window is 30 days wide; which
  // zone that midnight is read in moves an entry by hours, not by days.
  return toDbDate(bounds.endExclusive);
}

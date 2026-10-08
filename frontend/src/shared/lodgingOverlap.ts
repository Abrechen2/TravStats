/**
 * When two stays "overlap" - the rule behind the overlap notice on saving a
 * stay (forgejo#229) and the duplicate warning when staying again (forgejo#227).
 *
 * It is decided on the stays' LOCAL calendar days - the hotel's own days as
 * `times.checkIn.date` carries them - never on instants, so no reader's zone
 * can move a night onto its neighbour. And it reads them through
 * `lodgingTiming`'s rule about what a date is good for: only a stay that names
 * exact DAYS can overlap anything. A stay recorded as "July 2011" stores
 * placeholder dates spanning the month, and comparing them would invent
 * overlaps nobody recorded (the same AUD-083 trap `stayNamesExactDays` guards).
 *
 * The rule, in the owner's words (forgejo#229):
 * - the nights of a stay are `[check-in, check-out)`: the check-out day is
 *   free again, so a check-out and a check-in on the SAME day are a hand-over,
 *   not an overlap;
 * - a cancelled stay occupies nothing, on either side;
 * - two rooms in the same house for the same nights ARE flagged - the notice
 *   is a question, "absichtlich so" answers it, and nothing is ever blocked.
 *
 * Frontend only: the server does not decide this (it must never refuse a
 * stay for overlapping), so there is no backend mirror to keep in step. If the
 * server ever needs it, put the copy beside `backend/src/shared/lodgingTiming.ts`
 * and say so in both headers, as `lodgingCounting.ts` does.
 */
import { stayNamesExactDays } from "./lodgingTiming";

/** What the rule reads of a stay: its local days, its precision and whether it was cancelled. */
export interface StaySpan {
  /** `YYYY-MM-DD`, the hotel's local day. */
  checkIn: string | null;
  checkOut: string | null;
  datePrecision: string;
  cancelled: boolean;
}

export interface ExactDays {
  /** First night (`YYYY-MM-DD`). */
  from: string;
  /** Check-out day; equal to `from` for a stay that names one day only. */
  to: string;
}

const asDate = (day: string | null): Date | null =>
  day === null ? null : new Date(`${day}T00:00:00.000Z`);

/**
 * The days a stay occupies, or null when it names none: cancelled, not
 * day-precise, undated, or reversed (a check-out before the check-in is a
 * mistake the form refuses, not a span to compare).
 */
export function exactDays(span: StaySpan): ExactDays | null {
  if (span.cancelled) return null;
  const named = stayNamesExactDays({
    checkIn: asDate(span.checkIn),
    checkOut: asDate(span.checkOut),
    datePrecision: span.datePrecision,
    nights: null,
  });
  if (!named) return null;
  const from = span.checkIn ?? span.checkOut;
  const to = span.checkOut ?? span.checkIn;
  if (from === null || to === null || to < from) return null;
  return { from, to };
}

/**
 * Do the nights of `a` and `b` share a night? `[from, to)` against `[from, to)`
 * with strict comparisons, so a hand-over day is no overlap, and a stay that
 * names a single day (a day-use, or a check-in whose end is not known yet) sits
 * between two others without touching a boundary.
 */
export function staysOverlap(a: StaySpan, b: StaySpan): boolean {
  const first = exactDays(a);
  const second = exactDays(b);
  if (first === null || second === null) return false;
  return first.from < second.to && second.from < first.to;
}

/** The very same days - how a repeated entry of one booking looks. */
export function staysCoincide(a: StaySpan, b: StaySpan): boolean {
  const first = exactDays(a);
  const second = exactDays(b);
  if (first === null || second === null) return false;
  return first.from === second.from && first.to === second.to;
}

/**
 * Overlap OR identity. Two identical single-day stays share no night under the
 * strict rule above, yet are the textbook duplicate - so the notice asks about
 * both.
 */
export function staysConflict(a: StaySpan, b: StaySpan): boolean {
  return staysOverlap(a, b) || staysCoincide(a, b);
}

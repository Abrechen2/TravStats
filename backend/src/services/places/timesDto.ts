import {
  TIME_PRECISIONS,
  serializeTime,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import type { VisitTimes } from "../../schemas/times";

/**
 * A place visit's `times` (ADR 0002 phase 4).
 *
 * The truth is `visited_at_utc` + `visited_zone` + `visited_precision` —
 * written by every visit path since phase 2 and by the backfill for older
 * rows. `visited_at` is NOT read as a time: it holds the web's fake-UTC wall
 * clock and the Companion's real instant side by side, and nothing in the row
 * says which (the reason for Q4). A visit the backfill has not reached yet
 * therefore goes out with its stored date only — precision `unknown`, no zone
 * — which is exactly what Q4 decided for a visit whose writer is unknown.
 */
export interface VisitTimeColumns {
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
  visitedZone: string | null;
  visitedPrecision: string | null;
}

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && (TIME_PRECISIONS as readonly string[]).includes(value);

export function visitTime(v: VisitTimeColumns): TimeValue | null {
  if (v.visitedAtUtc) {
    const precision = isPrecision(v.visitedPrecision) ? v.visitedPrecision : "minute";
    return serializeTime(v.visitedAtUtc, v.visitedZone, precision);
  }
  return v.visitedAt ? serializeTime(v.visitedAt, null, "unknown") : null;
}

export function visitTimes(v: VisitTimeColumns): VisitTimes {
  return { visitedAt: visitTime(v) };
}

export function withVisitTimes<T extends VisitTimeColumns>(v: T): T & { times: VisitTimes } {
  return { ...v, times: visitTimes(v) };
}

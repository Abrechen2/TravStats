import {
  TIME_PRECISIONS,
  serializeTime,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import type { JournalEntryTimes, TripStopTimes, TripTimes } from "../../schemas/times";
import { readDay } from "../timeModel/readDay";

/**
 * A trip's, a timeline stop's and a journal entry's `times` (ADR 0002 phase 4).
 *
 * - A trip's first and last day are the local days of its first departure and
 *   last arrival, each with the zone it happened in (owner decision on the
 *   plan's open point 1); a span the user typed carries no zone.
 * - A stop's start and end are instants on the stop's clock
 *   (`start_utc`/`end_utc` + `stop_zone`). The legacy `start_date`/`end_date`
 *   hold the stop's wall clock as fake UTC; where no instant exists that clock
 *   has no zone to be read in, so it goes out with its date only
 *   (precision `unknown`, zone null) — never as an instant it is not.
 * - A journal entry's day belongs to no stored place, so its zone is null.
 */
export interface TripTimeColumns {
  startDate: Date | null;
  endDate: Date | null;
  startDay: Date | null;
  endDay: Date | null;
  startZone: string | null;
  endZone: string | null;
}

export interface TripStopTimeColumns {
  startDate: Date | null;
  endDate: Date | null;
  startUtc: Date | null;
  endUtc: Date | null;
  stopZone: string | null;
  precision: string | null;
}

export interface JournalTimeColumns {
  date: Date;
  day: Date | null;
}

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && (TIME_PRECISIONS as readonly string[]).includes(value);

function stopTime(
  instant: Date | null,
  legacy: Date | null,
  zone: string | null,
  precision: string | null
): TimeValue | null {
  if (instant) return serializeTime(instant, zone, isPrecision(precision) ? precision : "minute");
  return legacy ? serializeTime(legacy, null, "unknown") : null;
}

export function tripTimes(t: TripTimeColumns): TripTimes {
  return {
    start: readDay(t.startDay, t.startDate, t.startZone),
    end: readDay(t.endDay, t.endDate, t.endZone),
  };
}

export function tripStopTimes(s: TripStopTimeColumns): TripStopTimes {
  return {
    start: stopTime(s.startUtc, s.startDate, s.stopZone, s.precision),
    end: stopTime(s.endUtc, s.endDate, s.stopZone, s.precision),
  };
}

export function journalEntryTimes(e: JournalTimeColumns): JournalEntryTimes {
  return { day: readDay(e.day, e.date, null) };
}

export function withTripTimes<T extends TripTimeColumns>(t: T): T & { times: TripTimes } {
  return { ...t, times: tripTimes(t) };
}

export function withTripStopTimes<T extends TripStopTimeColumns>(
  s: T
): T & { times: TripStopTimes } {
  return { ...s, times: tripStopTimes(s) };
}

export function withJournalEntryTimes<T extends JournalTimeColumns>(
  e: T
): T & { times: JournalEntryTimes } {
  return { ...e, times: journalEntryTimes(e) };
}

import {
  TIME_PRECISIONS,
  serializeTime,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import type { CruiseStopTimes, CruiseTimes } from "../../schemas/times";
import { readDay } from "../timeModel/readDay";

/**
 * A cruise's and its port calls' `times` (ADR 0002 phase 4).
 *
 * Days come from the `DATE` columns with the port's zone (`readDay`). A port
 * call's hours come from `arrival_utc`/`departure_utc` with the port's zone.
 * The legacy `arrival_time`/`departure_time` hold the port's wall clock as
 * fake UTC; where no instant exists (a sea day that carries a clock, an
 * unresolved port, a row the backfill has not reached) that wall clock has no
 * zone to be read in, so it goes out with its date only — precision
 * `unknown`, zone null — rather than as an instant it is not.
 */
export interface CruiseTimeColumns {
  startDate: Date | null;
  endDate: Date | null;
  startDay: Date | null;
  endDay: Date | null;
  startZone: string | null;
  endZone: string | null;
}

export interface CruiseStopTimeColumns {
  date: Date | null;
  stopDate: Date | null;
  stopZone: string | null;
  arrivalTime: Date | null;
  departureTime: Date | null;
  arrivalUtc: Date | null;
  departureUtc: Date | null;
  timePrecision: string | null;
}

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && (TIME_PRECISIONS as readonly string[]).includes(value);

function callTime(
  instant: Date | null,
  legacy: Date | null,
  zone: string | null,
  precision: string | null
): TimeValue | null {
  if (instant) return serializeTime(instant, zone, isPrecision(precision) ? precision : "minute");
  return legacy ? serializeTime(legacy, null, "unknown") : null;
}

export function cruiseStopTimes(s: CruiseStopTimeColumns): CruiseStopTimes {
  return {
    date: readDay(s.stopDate, s.date, s.stopZone),
    arrival: callTime(s.arrivalUtc, s.arrivalTime, s.stopZone, s.timePrecision),
    departure: callTime(s.departureUtc, s.departureTime, s.stopZone, s.timePrecision),
  };
}

export function cruiseTimes(c: CruiseTimeColumns): CruiseTimes {
  return {
    start: readDay(c.startDay, c.startDate, c.startZone),
    end: readDay(c.endDay, c.endDate, c.endZone),
  };
}

/** A cruise with its `times`, and each of its stops (when included) with theirs. */
export function withCruiseTimes<
  S extends CruiseStopTimeColumns,
  T extends CruiseTimeColumns & { stops?: S[] },
>(cruise: T): T & { times: CruiseTimes } {
  return {
    ...cruise,
    ...(cruise.stops && {
      stops: cruise.stops.map((s) => ({ ...s, times: cruiseStopTimes(s) })),
    }),
    times: cruiseTimes(cruise),
  };
}

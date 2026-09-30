import {
  TIME_PRECISIONS,
  serializeTime,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import type { RailTimes } from "../../schemas/times";

/**
 * A rail journey's `times` (ADR 0002 phase 4). Rail stores real instants and,
 * since phase 2, the zone of each station — the catalogue's first, the
 * coordinates' second, never a fallback. A journey stored before that has no
 * zone: its instants go out as the UTC reading with `zone: null`, labelled,
 * and the migration report lists it (`instant_without_zone`).
 */
export interface RailTimeColumns {
  departureTime: Date;
  arrivalTime: Date | null;
  actualDepartureTime: Date | null;
  actualArrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depPrecision: string | null;
  arrPrecision: string | null;
}

const precisionOf = (value: string | null): TimePrecision =>
  value !== null && (TIME_PRECISIONS as readonly string[]).includes(value)
    ? (value as TimePrecision)
    : "minute";

const at = (time: Date | null, zone: string | null, precision: TimePrecision): TimeValue | null =>
  time ? serializeTime(time, zone, precision) : null;

export function railTimes(j: RailTimeColumns): RailTimes {
  return {
    departure: at(j.departureTime, j.depTimezone, precisionOf(j.depPrecision)),
    arrival: at(j.arrivalTime, j.arrTimezone, precisionOf(j.arrPrecision)),
    actualDeparture: at(j.actualDepartureTime, j.depTimezone, "minute"),
    actualArrival: at(j.actualArrivalTime, j.arrTimezone, "minute"),
  };
}

/** The row with its `times`; any other keys pass through untouched. */
export function withRailTimes<T extends RailTimeColumns>(j: T): T & { times: RailTimes } {
  return { ...j, times: railTimes(j) };
}

/** The detail read: the journey and every leg of its booking, each with its `times`. */
export function withRailDetailTimes<
  L extends RailTimeColumns,
  T extends RailTimeColumns & { booking: { railJourneys: L[] } | null },
>(j: T): T & { times: RailTimes } {
  return {
    ...withRailTimes(j),
    booking: j.booking && { ...j.booking, railJourneys: j.booking.railJourneys.map(withRailTimes) },
  };
}

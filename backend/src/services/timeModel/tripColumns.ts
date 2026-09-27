import { localDay } from "../../shared/time/instant";
import { toDbDate } from "../../shared/time/localDate";
import { zoneOf } from "../../shared/time/zoneOf";
import { dbDayOf } from "./dayColumns";
import { instantOfFakeUtc } from "../../shared/time/resolveInput";

/**
 * A trip's span as local days (ADR 0002 phase 2, owner decision 2026-09-26
 * on the plan's open point 1): the day of the first departure and of the last
 * arrival, each in the zone of the place it happened at. A span the user
 * TYPED names no place, so its days carry no zone.
 */

export interface TripDayColumns {
  startDay?: Date | null;
  endDay?: Date | null;
  startZone?: string | null;
  endZone?: string | null;
}

/** Day columns for typed dates; a key that was not sent stays out. */
export function typedTripDays(body: {
  startDate?: Date | null;
  endDate?: Date | null;
}): TripDayColumns {
  return {
    ...(body.startDate !== undefined && {
      startDay: body.startDate ? dbDayOf(body.startDate) : null,
      startZone: null,
    }),
    ...(body.endDate !== undefined && {
      endDay: body.endDate ? dbDayOf(body.endDate) : null,
      endZone: null,
    }),
  };
}

/** A dated segment end: the instant and where it happened. */
export interface SegmentEnd {
  at: Date;
  zone?: string | null;
  lat?: number | null;
  lon?: number | null;
}

function dayAt(end: SegmentEnd): { day: Date; zone: string | null } {
  const zone = end.zone ?? zoneOf({ lat: end.lat, lon: end.lon });
  return zone
    ? { day: toDbDate(localDay(end.at, zone)), zone }
    : { day: dbDayOf(end.at), zone: null };
}

/**
 * Day columns for a span derived from real instants (flight and rail ends):
 * the earliest departure's local day and the latest arrival's. Without a zone
 * the UTC day is kept and the zone left null — the backfill reports it.
 */
export function segmentTripDays(starts: SegmentEnd[], ends: SegmentEnd[]): TripDayColumns {
  const first = [...starts].sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const last = [...ends].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const start = first ? dayAt(first) : null;
  const end = last ? dayAt(last) : null;
  return {
    startDay: start?.day ?? null,
    startZone: start?.zone ?? null,
    endDay: end?.day ?? null,
    endZone: end?.zone ?? null,
  };
}

/** The ends of flights, for `segmentTripDays`. */
export function flightEnds(
  flights: Array<{
    departureTime: Date | null;
    arrivalTime: Date | null;
    depTimezone?: string | null;
    arrTimezone?: string | null;
    depLat?: number | null;
    depLon?: number | null;
    arrLat?: number | null;
    arrLon?: number | null;
  }>
): { starts: SegmentEnd[]; ends: SegmentEnd[] } {
  const starts: SegmentEnd[] = [];
  const ends: SegmentEnd[] = [];
  for (const f of flights) {
    if (f.departureTime) {
      starts.push({ at: f.departureTime, zone: f.depTimezone, lat: f.depLat, lon: f.depLon });
    }
    const arrival = f.arrivalTime
      ? { at: f.arrivalTime, zone: f.arrTimezone, lat: f.arrLat, lon: f.arrLon }
      : f.departureTime
        ? { at: f.departureTime, zone: f.depTimezone, lat: f.depLat, lon: f.depLon }
        : null;
    if (arrival) ends.push(arrival);
  }
  return { starts, ends };
}

/**
 * A roadtrip station's time columns (ADR 0002 phase 2 dual-write). A station
 * is dated by DAYS — the night it was slept at — held in the legacy columns
 * as UTC midnight; the new instant is that day's start at the station, which
 * has coordinates by construction, so its zone is known. Precision `day`.
 */
export function stationTimeColumns(v: {
  startDate: Date | null;
  endDate: Date | null;
  lat: number | null;
  lon: number | null;
}): {
  startUtc: Date | null;
  endUtc: Date | null;
  stopZone: string | null;
  precision: string | null;
} {
  const zone = zoneOf({ lat: v.lat, lon: v.lon });
  const at = (day: Date | null): Date | null =>
    day && zone ? instantOfFakeUtc(dbDayOf(day), zone) : null;
  const dated = v.startDate !== null || v.endDate !== null;
  return {
    startUtc: at(v.startDate),
    endUtc: at(v.endDate),
    stopZone: zone,
    precision: dated ? (zone ? "day" : "unknown") : null,
  };
}

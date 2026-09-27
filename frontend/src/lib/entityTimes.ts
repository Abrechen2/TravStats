/**
 * Every entity's times as `TimeValue` / `LocalDateValue` — the one place the
 * web reads them (ADR 0002, phase 4).
 *
 * The server sends a `times` object beside each entity's old fields. A
 * component asks here and gets the place's own clock (`local`) to display and
 * `utc` to sort and measure; it never reads `departureTime`, `checkIn` or
 * `visitedAt` and formats them itself, which is how the same flight used to
 * read at three different hours on three screens.
 *
 * Where `times` is absent (an older server, a payload that has not moved yet)
 * the old fields are read through shared/time's legacy readers, which invent
 * no zone. That fallback goes in phase 6 with the old fields.
 */
import {
  localDateFromDayColumn,
  timeValueAtZone,
  timeValueFromWallClock,
  type LocalDateValue,
  type TimePrecision,
  type TimeValue,
} from "../shared/time";
import type { Flight, Trip, TripStop } from "../types";
import type { Cruise, CruiseStop } from "../types/cruise";
import type { TripJournalEntry } from "../types/journal";
import type { LodgingStay } from "../types/lodging";
import type { PlaceVisit } from "../types/place";
import type { RailJourney } from "../types/rail";

type Semantics = Flight["depTimeSemantics"];

/** Phase-2/3 columns some payloads already carry; read when `times` is missing. */
type Maybe<T> = T & Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function flightPrecision(semantics: Semantics, stored: unknown): TimePrecision {
  const explicit = str(stored);
  if (explicit) return explicit as TimePrecision;
  if (semantics === "DATE_ONLY") return "day";
  if (semantics === "UNKNOWN") return "unknown";
  return "minute";
}

type FlightLike = Pick<
  Flight,
  | "departureTime"
  | "arrivalTime"
  | "depTimezone"
  | "arrTimezone"
  | "depTimeSemantics"
  | "arrTimeSemantics"
> &
  Partial<Pick<Flight, "actualDeparture" | "actualArrival" | "times">>;

function flightEnd(flight: FlightLike, end: "dep" | "arr", actual: boolean): TimeValue | null {
  const times = flight.times;
  const fromServer = actual
    ? end === "dep"
      ? times?.actualDeparture
      : times?.actualArrival
    : end === "dep"
      ? times?.departure
      : times?.arrival;
  if (fromServer) return fromServer;
  const row = flight as Maybe<FlightLike>;
  const semantics = end === "dep" ? flight.depTimeSemantics : flight.arrTimeSemantics;
  const zone = end === "dep" ? flight.depTimezone : flight.arrTimezone;
  const utc = actual
    ? end === "dep"
      ? flight.actualDeparture
      : flight.actualArrival
    : end === "dep"
      ? flight.departureTime
      : flight.arrivalTime;
  if (!actual && semantics === "LEGACY_FAKE_UTC" && !zone) return timeValueFromWallClock(utc);
  const precision = actual
    ? "minute"
    : flightPrecision(semantics, row[end === "dep" ? "depPrecision" : "arrPrecision"]);
  return timeValueAtZone(utc, zone, precision);
}

export const flightDeparture = (f: FlightLike): TimeValue | null => flightEnd(f, "dep", false);
export const flightArrival = (f: FlightLike): TimeValue | null => flightEnd(f, "arr", false);
export const flightActualDeparture = (f: FlightLike): TimeValue | null => flightEnd(f, "dep", true);
export const flightActualArrival = (f: FlightLike): TimeValue | null => flightEnd(f, "arr", true);

export type RailLike = Pick<
  RailJourney,
  "departureTime" | "arrivalTime" | "depTimezone" | "arrTimezone"
> &
  Partial<Pick<RailJourney, "actualDepartureTime" | "actualArrivalTime" | "times">>;

export function railDeparture(j: RailLike): TimeValue | null {
  return j.times?.departure ?? timeValueAtZone(j.departureTime, j.depTimezone);
}
export function railArrival(j: RailLike): TimeValue | null {
  return j.times?.arrival ?? timeValueAtZone(j.arrivalTime, j.arrTimezone);
}
export function railActualDeparture(j: RailLike): TimeValue | null {
  return j.times?.actualDeparture ?? timeValueAtZone(j.actualDepartureTime, j.depTimezone);
}
export function railActualArrival(j: RailLike): TimeValue | null {
  return j.times?.actualArrival ?? timeValueAtZone(j.actualArrivalTime, j.arrTimezone);
}

type StayLike = Pick<LodgingStay, "checkIn" | "checkOut"> & Partial<Pick<LodgingStay, "times">>;

export function stayCheckIn(s: StayLike): LocalDateValue | null {
  const row = s as Maybe<StayLike>;
  return (
    s.times?.checkIn ?? localDateFromDayColumn(str(row.checkInDate) ?? s.checkIn, str(row.stayZone))
  );
}
export function stayCheckOut(s: StayLike): LocalDateValue | null {
  const row = s as Maybe<StayLike>;
  return (
    s.times?.checkOut ??
    localDateFromDayColumn(str(row.checkOutDate) ?? s.checkOut, str(row.stayZone))
  );
}

type VisitLike = Pick<PlaceVisit, "visitedAt"> & Partial<Pick<PlaceVisit, "times">>;

export function visitTime(v: VisitLike): TimeValue | null {
  if (v.times?.visitedAt) return v.times.visitedAt;
  const row = v as Maybe<VisitLike>;
  const utc = str(row.visitedAtUtc);
  const zone = str(row.visitedZone);
  if (utc && zone) {
    return timeValueAtZone(utc, zone, (str(row.visitedPrecision) as TimePrecision) ?? "minute");
  }
  return timeValueFromWallClock(v.visitedAt);
}

type CruiseStopLike = Pick<CruiseStop, "date" | "arrivalTime" | "departureTime"> &
  Partial<Pick<CruiseStop, "arrivalUtc" | "departureUtc" | "stopZone" | "times">>;

function cruiseStopClock(stop: CruiseStopLike, end: "arrival" | "departure"): TimeValue | null {
  const fromServer = stop.times?.[end];
  if (fromServer) return fromServer;
  const utc = end === "arrival" ? stop.arrivalUtc : stop.departureUtc;
  if (utc && stop.stopZone) return timeValueAtZone(utc, stop.stopZone);
  return timeValueFromWallClock(end === "arrival" ? stop.arrivalTime : stop.departureTime);
}

export const cruiseStopArrival = (s: CruiseStopLike): TimeValue | null =>
  cruiseStopClock(s, "arrival");
export const cruiseStopDeparture = (s: CruiseStopLike): TimeValue | null =>
  cruiseStopClock(s, "departure");
export function cruiseStopDay(s: CruiseStopLike): LocalDateValue | null {
  return s.times?.date ?? localDateFromDayColumn(s.date, s.stopZone ?? null);
}

type CruiseLike = Pick<Cruise, "startDate" | "endDate"> & Partial<Pick<Cruise, "times">>;

export const cruiseStart = (c: CruiseLike): LocalDateValue | null =>
  c.times?.start ?? localDateFromDayColumn(c.startDate);
export const cruiseEnd = (c: CruiseLike): LocalDateValue | null =>
  c.times?.end ?? localDateFromDayColumn(c.endDate);

type TripLike = Pick<Trip, "startDate" | "endDate"> & Partial<Pick<Trip, "times">>;

export const tripStart = (t: TripLike): LocalDateValue | null =>
  t.times?.start ?? localDateFromDayColumn(t.startDate);
export const tripEnd = (t: TripLike): LocalDateValue | null =>
  t.times?.end ?? localDateFromDayColumn(t.endDate);

type TripStopLike = Pick<TripStop, "startDate" | "endDate"> & Partial<Pick<TripStop, "times">>;

function tripStopClock(stop: TripStopLike, end: "start" | "end"): TimeValue | null {
  const fromServer = stop.times?.[end];
  if (fromServer) return fromServer;
  const row = stop as Maybe<TripStopLike>;
  const utc = str(row[end === "start" ? "startUtc" : "endUtc"]);
  const zone = str(row.stopZone);
  if (utc && zone) {
    return timeValueAtZone(utc, zone, (str(row.precision) as TimePrecision) ?? "minute");
  }
  return timeValueFromWallClock(end === "start" ? stop.startDate : stop.endDate);
}

export const tripStopStart = (s: TripStopLike): TimeValue | null => tripStopClock(s, "start");
export const tripStopEnd = (s: TripStopLike): TimeValue | null => tripStopClock(s, "end");

type JournalLike = Pick<TripJournalEntry, "date"> & Partial<Pick<TripJournalEntry, "times">>;

export function journalDay(e: JournalLike): LocalDateValue | null {
  const row = e as Maybe<JournalLike>;
  return e.times?.day ?? localDateFromDayColumn(str(row.day) ?? e.date);
}

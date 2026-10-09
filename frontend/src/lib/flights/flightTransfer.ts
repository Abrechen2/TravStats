import { flightArrival, flightDeparture } from "../entityTimes";
import { localDay, type TimeValue } from "../../shared/time";
import type { Flight } from "../../types";

/**
 * What lies between two consecutive flight segments of a booking
 * (forgejo#218): the wait, a departure before the previous landing, a change
 * of airport — or nothing that can be said. ONE home for that verdict.
 *
 * The rules are the rail transfer rules (`lib/rail/railTransfer.ts` on the
 * rail branch), applied to flights:
 * - A wait is measured only between two instants known to the minute
 *   (`TimeValue.utc`, so a change across zones measures what really passes);
 *   a day-only or missing end makes it `unknown` — never 0.
 * - The segments arrive in stored departure order, and a day-only departure
 *   is stored at the airport's local midnight, so it sorts before every timed
 *   flight of its day whether or not it left first. Where that order is not
 *   KNOWN, every claim that rests on it (the wait, the airport, "another
 *   journey") is withheld: `unknown`, reason `order`.
 *
 * Nothing here claims a connection WORKS. No minimum connecting time is
 * known or implied; the view states the gap and the airports, nothing more.
 */

export type TransferSegment = Pick<
  Flight,
  | "depIata"
  | "depIcao"
  | "arrIata"
  | "arrIcao"
  | "depLat"
  | "depLon"
  | "arrLat"
  | "arrLon"
  | "departureTime"
  | "arrivalTime"
> &
  Partial<
    Pick<Flight, "depTimezone" | "arrTimezone" | "depTimeSemantics" | "arrTimeSemantics" | "times">
  >;

/**
 * "Must I go to another airport?"
 * - `same`: the same airport code;
 * - `change`: another airport, with the straight-line distance where both
 *   positions are known (never a travel time, which nothing here knows);
 * - `unconfirmed`: a code is missing on one side, so it cannot be told.
 */
export type AirportVerdict =
  | { kind: "same" }
  | { kind: "change"; from: string; to: string; km: number | null }
  | { kind: "unconfirmed" };

export type FlightTransfer =
  /** Either end is not known to the minute, or missing. */
  | { kind: "unknown"; reason: "time"; airport: AirportVerdict }
  /** The two segments' order itself is not known, so no airport is claimed either. */
  | { kind: "unknown"; reason: "order" }
  /** The next flight leaves before the previous one lands; `minutes` is negative. */
  | { kind: "conflict"; minutes: number; airport: AirportVerdict }
  | { kind: "transfer"; minutes: number; airport: AirportVerdict }
  /**
   * Not a change of planes: the next flight leaves more than a day later (a
   * stopover, the return), or goes back to an airport this journey already
   * passed. Nothing about a wait is claimed.
   */
  | { kind: "separate" };

/**
 * The longest wait still read as a change of planes. IATA's own line between
 * a connection and a stopover on an international itinerary is 24 hours.
 */
export const SEPARATE_JOURNEY_AFTER_MINUTES = 24 * 60;

interface AirportRef {
  iata: string | null;
  icao: string | null;
  lat: number | null;
  lon: number | null;
}

const code = (c: string | null | undefined): string | null =>
  c && c.trim() !== "" ? c.trim().toUpperCase() : null;

const arrivalAirport = (s: TransferSegment): AirportRef => ({
  iata: code(s.arrIata),
  icao: code(s.arrIcao),
  lat: s.arrLat ?? null,
  lon: s.arrLon ?? null,
});
const departureAirport = (s: TransferSegment): AirportRef => ({
  iata: code(s.depIata),
  icao: code(s.depIcao),
  lat: s.depLat ?? null,
  lon: s.depLon ?? null,
});

/** Same airport by ICAO where both carry one, else by IATA; null when it cannot be told. */
export function sameAirport(a: AirportRef, b: AirportRef): boolean | null {
  if (a.icao && b.icao) return a.icao === b.icao;
  if (a.iata && b.iata) return a.iata === b.iata;
  return null;
}

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

function distanceKm(a: AirportRef, b: AirportRef): number | null {
  if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) return null;
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function transferAirport(arrival: AirportRef, departure: AirportRef): AirportVerdict {
  const same = sameAirport(arrival, departure);
  if (same === null) return { kind: "unconfirmed" };
  if (same) return { kind: "same" };
  return {
    kind: "change",
    from: arrival.iata ?? arrival.icao ?? "",
    to: departure.iata ?? departure.icao ?? "",
    km: distanceKm(arrival, departure),
  };
}

/** Minutes from the previous landing to the next take-off, signed; null when not both known to the minute. */
export function signedTransferMinutes(
  previous: TransferSegment,
  next: TransferSegment
): number | null {
  const arrival = flightArrival(previous);
  const departure = flightDeparture(next);
  if (!arrival || !departure) return null;
  if (arrival.precision !== "minute" || departure.precision !== "minute") return null;
  const minutes = Math.round((Date.parse(departure.utc) - Date.parse(arrival.utc)) / 60_000);
  return Number.isFinite(minutes) ? minutes : null;
}

const dayOf = (value: TimeValue | null): string | null =>
  value && (value.precision === "minute" || value.precision === "day")
    ? value.local.slice(0, 10)
    : null;

const daysApart = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The verdict for one pair of consecutive segments whose ORDER is known. */
export function flightTransfer(previous: TransferSegment, next: TransferSegment): FlightTransfer {
  const airport = transferAirport(arrivalAirport(previous), departureAirport(next));
  const minutes = signedTransferMinutes(previous, next);
  if (minutes === null) {
    const from = dayOf(flightArrival(previous)) ?? dayOf(flightDeparture(previous));
    const to = dayOf(flightDeparture(next));
    if (from !== null && to !== null && daysApart(from, to) > 1) return { kind: "separate" };
    return { kind: "unknown", reason: "time", airport };
  }
  if (minutes < 0) return { kind: "conflict", minutes, airport };
  if (minutes > SEPARATE_JOURNEY_AFTER_MINUTES) return { kind: "separate" };
  return { kind: "transfer", minutes, airport };
}

const HOUR_MS = 3_600_000;
/** A zone is at most UTC+14 / UTC−12: the widest a day of unknown zone can lie. */
const UNKNOWN_ZONE_MARGIN_MS = 14 * HOUR_MS;

/**
 * When a segment left, as an interval of instants `[start, end)`: one instant
 * for a departure known to the minute; the whole local day at the airport for
 * one known only by its day. Null when not even the day is known.
 *
 * The server stores a day-only departure at the airport's local midnight
 * (`services/flights/timesDto.ts`, `DATE_ONLY`). Should a value carry a clock
 * anyway, the day is taken back to its midnight from the wall clock, so the
 * interval is never narrower than the day.
 */
function departureWindow(segment: TransferSegment): { start: number; end: number } | null {
  const departure = flightDeparture(segment);
  if (!departure) return null;
  const at = Date.parse(departure.utc);
  if (!Number.isFinite(at)) return null;
  if (departure.precision === "minute") return { start: at, end: at };
  if (departure.precision !== "day") return null;
  const clock = /T(\d{2}):(\d{2})/.exec(departure.local);
  const sinceMidnight = clock ? (Number(clock[1]) * 60 + Number(clock[2])) * 60_000 : 0;
  const start = at - sinceMidnight;
  if (departure.zone === null) {
    return {
      start: start - UNKNOWN_ZONE_MARGIN_MS,
      end: start + 24 * HOUR_MS + UNKNOWN_ZONE_MARGIN_MS,
    };
  }
  const zone = departure.zone;
  const day = localDay(new Date(start).toISOString(), zone);
  const hours = [23, 24, 25].find(
    (h) => localDay(new Date(start + h * HOUR_MS).toISOString(), zone) !== day
  );
  return { start, end: start + (hours ?? 25) * HOUR_MS };
}

/** Did `a` certainly leave no later than `b`? Days compare only once wholly apart. */
function leftBefore(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const aPoint = a.start === a.end;
  const bPoint = b.start === b.end;
  if (aPoint && bPoint) return a.start <= b.start;
  if (aPoint) return a.start < b.start;
  return a.end <= b.start;
}

/**
 * Is the order of `segments[i]` and `segments[i + 1]` known? Only when the
 * first certainly left before the second, and every OTHER segment certainly
 * left before the first or after the second.
 */
function gapOrderKnown(segments: readonly TransferSegment[], i: number): boolean {
  const windows = segments.map(departureWindow);
  const previous = windows[i];
  const next = windows[i + 1];
  if (previous === null || next === null || !leftBefore(previous, next)) return false;
  return windows.every((window, j) => {
    if (j === i || j === i + 1) return true;
    return window !== null && (leftBefore(window, previous) || leftBefore(next, window));
  });
}

/**
 * The verdict between every two consecutive segments, in the order given
 * (stored departure order): entry `i` is the gap after `segments[i]`. A
 * segment that flies back to an airport this journey already passed starts
 * another journey — the return is not a connection, however soon it leaves.
 */
export function flightTransfers(segments: readonly TransferSegment[]): FlightTransfer[] {
  const verdicts: FlightTransfer[] = [];
  let visited: AirportRef[] = segments.length > 0 ? [departureAirport(segments[0])] : [];
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const previous = segments[i];
    const next = segments[i + 1];
    if (!gapOrderKnown(segments, i)) {
      verdicts.push({ kind: "unknown", reason: "order" });
      visited = [departureAirport(next)];
      continue;
    }
    visited = [...visited, arrivalAirport(previous)];
    const verdict = flightTransfer(previous, next);
    const wayBack = visited.some((airport) => sameAirport(airport, arrivalAirport(next)) === true);
    if (verdict.kind === "separate" || (wayBack && verdict.kind !== "conflict")) {
      verdicts.push({ kind: "separate" });
      visited = [departureAirport(next)];
    } else {
      verdicts.push(verdict);
    }
  }
  return verdicts;
}

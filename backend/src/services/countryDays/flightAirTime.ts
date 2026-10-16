/**
 * "Was this position taken in the air, on a flight this account flew?" — the
 * overflight half of forgejo#299.
 *
 * forgejo#299 (owner, 2026-10-13): *"Ein Überflug oder fehlerhafter Standort
 * darf weder Bodenkontakt noch Besuch belegen"* and *"GPS/Dawarich:
 * Flugpunkte und Ausreißer ausschließen"*. Measured on prod on 2026-10-16: one
 * point each in Syria and Lebanon during EK052 MUC–DXB, 1,686 in Romania and
 * 677 in China during LH718 MUC–ICN, 476 in Spain and 111 in Cape Verde during
 * LH506 FRA–GRU — about ten countries the owner never set foot in, each one a
 * `CountryDay` row because nothing asked whether the phone was at 11 km.
 *
 * A flown flight is the one record that answers that. Between its departure
 * and its arrival the traveller is in the cabin, so a position in that span
 * says something about the route, never about the ground — except in the two
 * countries the flight actually touches, where the traveller stood before
 * boarding and after landing. Those two stay; every other country in the span
 * is dropped before it can become a row.
 *
 * ## The instants are the real ones, or there is no window
 *
 * `flightTimes()` is the project's single reader of a flight's clocks
 * (ADR 0002): a `LEGACY_FAKE_UTC` value is read as its airport's wall clock,
 * a `DATE_ONLY` or year-only placeholder comes back with a precision other
 * than `minute`. Only minute-precision ends make a window. A flight whose
 * clocks are not evidence gets none rather than a guessed one — the speed rule
 * in `./reduce.ts` still catches its cruise points, and a window invented from
 * a noon placeholder would drop real ground points on a day the flight did not
 * even depart at noon.
 *
 * Provider readings (actual and runway times) widen the window when present:
 * a two-hour delay recorded only as `actualDeparture` must not leave the last
 * two hours of the flight outside it.
 */

import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import type { TimeValue } from "../../shared/time/wire";
import { flightTimes } from "../flights/timesDto";
import { buildTzMap, flightEndZone } from "../stats/departureClock";
import type { InFlightTest } from "./reduce";

/**
 * Taxi and boarding on either side of the clocks. Points in this margin are in
 * an endpoint's country anyway — the gate, the apron — so a margin that is
 * slightly too wide costs nothing there; it only has to cover the minutes the
 * stored clocks do not.
 */
const TAXI_PADDING_MS = 30 * 60_000;

/**
 * A window longer than this is a data error (a wrong date on one end), not a
 * flight: the longest scheduled flight is under 19 hours. Such a row gets no
 * window rather than one that would swallow a day of real ground points.
 */
const MAX_AIR_TIME_MS = 24 * 3_600_000;

export interface FlightAirWindow {
  /** Padded start, milliseconds since epoch. */
  startMs: number;
  /** Padded end, milliseconds since epoch. */
  endMs: number;
  /** The countries the flight touches — departure and arrival airport. */
  endpointCountries: ReadonlySet<string>;
}

/** The columns `buildFlightAirTimeTest` reads; the pure half takes the result. */
const FLIGHT_AIR_TIME_SELECT = {
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  actualDeparture: true,
  actualArrival: true,
  runwayDepartureTime: true,
  runwayArrivalTime: true,
  onlineCheckInOpensAt: true,
  onlineCheckInZone: true,
} as const;

/** A real instant, or null when the value is a placeholder or missing. */
function instantMs(value: TimeValue | null): number | null {
  if (!value || value.precision !== "minute") return null;
  const ms = Date.parse(value.utc);
  return Number.isFinite(ms) ? ms : null;
}

function earliest(values: readonly (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  return real.length > 0 ? Math.min(...real) : null;
}

function latest(values: readonly (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  return real.length > 0 ? Math.max(...real) : null;
}

/**
 * The window of one flight from its resolved times, or null when either end
 * has no real instant or the span is not a plausible flight.
 */
export function airWindowOf(
  times: {
    departure: TimeValue | null;
    arrival: TimeValue | null;
    actualDeparture?: TimeValue | null;
    actualArrival?: TimeValue | null;
    runwayDeparture?: TimeValue | null;
    runwayArrival?: TimeValue | null;
  },
  endpointCountries: ReadonlySet<string>
): FlightAirWindow | null {
  const start = earliest([
    instantMs(times.departure),
    instantMs(times.actualDeparture ?? null),
    instantMs(times.runwayDeparture ?? null),
  ]);
  const end = latest([
    instantMs(times.arrival),
    instantMs(times.actualArrival ?? null),
    instantMs(times.runwayArrival ?? null),
  ]);
  if (start === null || end === null) return null;
  if (end <= start || end - start > MAX_AIR_TIME_MS) return null;
  return {
    startMs: start - TAXI_PADDING_MS,
    endMs: end + TAXI_PADDING_MS,
    endpointCountries,
  };
}

/**
 * The pure half: true when a position at `timestampMs` in `countryCode` lies
 * inside some flight's air time and in neither of that flight's countries.
 *
 * Windows of a connection overlap at the hub, and the hub is an endpoint of
 * both, so a layover point survives either window. A point is dropped only
 * when a window that contains it does not list its country.
 */
export function flightAirTimeTest(windows: readonly FlightAirWindow[]): InFlightTest {
  if (windows.length === 0) return () => false;
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);

  return (timestampMs: number, countryCode: string): boolean => {
    for (const window of sorted) {
      if (window.startMs > timestampMs) break;
      if (window.endMs < timestampMs) continue;
      if (!window.endpointCountries.has(countryCode)) return true;
    }
    return false;
  };
}

/**
 * Build the test for one account from its countable flights.
 *
 * `countryAt` is the sweep's own resolver, so "the country of the departure
 * airport" is answered by exactly the boundaries that answer "the country of
 * this point" — a catalogue country code and a polygon could disagree at a
 * border airport (Basel-Mulhouse stands on French soil) and the disagreement
 * would drop the traveller's real ground points.
 */
export async function buildFlightAirTimeTest(
  userId: string,
  countryAt: (lat: number, lon: number) => string | null
): Promise<InFlightTest> {
  const flights = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: FLIGHT_AIR_TIME_SELECT,
  });
  if (flights.length === 0) return () => false;

  const tzMap = await buildTzMap(flights);
  const windows: FlightAirWindow[] = [];
  for (const flight of flights) {
    const times = flightTimes(flight, {
      dep: flightEndZone(null, tzMap, flight.depIata, flight.depIcao),
      arr: flightEndZone(null, tzMap, flight.arrIata, flight.arrIcao),
    });
    const endpoints = new Set<string>();
    const dep = countryAt(flight.depLat, flight.depLon);
    const arr = countryAt(flight.arrLat, flight.arrLon);
    if (dep) endpoints.add(dep);
    if (arr) endpoints.add(arr);
    const window = airWindowOf(times, endpoints);
    if (window) windows.push(window);
  }
  return flightAirTimeTest(windows);
}

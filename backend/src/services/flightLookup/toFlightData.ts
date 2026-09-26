/**
 * The UI-facing `FlightData` shape of one cascade result, with each airport's
 * own clock attached.
 *
 * `scheduledTime` is a UTC instant. The flight form wants the wall clock at
 * each airport, and it used to cut the hours out of the instant's text — so
 * LH400 leaving Frankfurt at 13:25 was entered as 11:25, and saved that way.
 * The conversion needs the airport's zone, which the server has and the form
 * would otherwise have to look up again; so the answer carries it:
 * `timezone` (IANA) and `scheduledLocal` ("YYYY-MM-DDTHH:mm" at that airport).
 * Both are absent when the zone is unknown — never guessed from the server's
 * or the browser's clock.
 */

import { formatInTimeZone } from "date-fns-tz";
import { getAirportTimezone } from "../../utils/timezone";
import type { FlightData, FlightLookupResult } from "../flightLookup";

/** Coerce `string | null | undefined` -> `string | undefined` (FlightData fields don't accept null). */
const toUndef = (value: string | null | undefined): string | undefined =>
  value === null ? undefined : value;

/** An ISO string that names its own offset, i.e. a real instant. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** The airport's zone and the instant's wall clock there, when both are known. */
export async function airportClock(
  instant: string | undefined,
  airportCode: string | undefined
): Promise<{ timezone?: string; scheduledLocal?: string }> {
  const timezone = airportCode ? await getAirportTimezone(airportCode) : null;
  if (!timezone) return {};
  if (!instant || !HAS_ZONE.test(instant)) return { timezone };
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return { timezone };
  return { timezone, scheduledLocal: formatInTimeZone(parsed, timezone, "yyyy-MM-dd'T'HH:mm") };
}

/** Map a `lookupFlightDetails` result onto the legacy `FlightData` shape. */
export async function flightLookupResultToFlightData(
  result: FlightLookupResult,
  fallbackFlightNumber: string
): Promise<FlightData> {
  const depCode = toUndef(result.departure?.iata) ?? toUndef(result.departure?.icao);
  const arrCode = toUndef(result.arrival?.iata) ?? toUndef(result.arrival?.icao);
  const [depClock, arrClock] = await Promise.all([
    airportClock(result.departureTime, depCode),
    airportClock(result.arrivalTime, arrCode),
  ]);
  return {
    flightNumber: result.flightNumber || fallbackFlightNumber,
    airline: result.airline || "Unknown",
    airlineIata: result.airlineIata,
    airlineIcao: result.airlineIcao,
    operatingAirline: result.operatingAirline,
    isCodeshare: result.isCodeshare,
    callsign: result.callsign,
    departure: {
      iata: toUndef(result.departure?.iata),
      icao: toUndef(result.departure?.icao),
      name: result.departure?.name,
      scheduledTime: result.departureTime,
      actualTime: result.actualDeparture,
      terminal: result.departure?.terminal,
      gate: result.departure?.gate,
      ...depClock,
    },
    arrival: {
      iata: toUndef(result.arrival?.iata),
      icao: toUndef(result.arrival?.icao),
      name: result.arrival?.name,
      scheduledTime: result.arrivalTime,
      actualTime: result.actualArrival,
      terminal: result.arrival?.terminal,
      gate: result.arrival?.gate,
      ...arrClock,
    },
    aircraft: result.aircraft,
    aircraftRegistration: result.aircraftRegistration,
    aircraftModeS: result.aircraftModeS,
    status: result.statusOverride,
    distance: result.distanceKm,
  };
}

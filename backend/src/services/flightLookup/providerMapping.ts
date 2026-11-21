/**
 * Mapping of provider answers onto `FlightLookupResult` — the airport side
 * (static metadata from our airport table plus live gate/terminal from the
 * provider) and the AirLabs result. Pulled out of `lookupFlightDetails` so
 * each step stays readable; behaviour is unchanged.
 */

import { findOrCreateAirport } from "../airportLookup";
import { convertAirlabsTimeToUtc } from "../../utils/timezone";
import { getAirlineName } from "./fieldReaders";
import type { FlightData } from "./airlabs";
import type { AirportInfo } from "./providerTypes";
import type { FlightLookupResult } from "../flightLookup";

type AirportRow = NonNullable<Awaited<ReturnType<typeof findOrCreateAirport>>>;

/**
 * Merge per-flight fields (gate/terminal) onto the airport record.
 * findOrCreateAirport only supplies static metadata (name/lat/lon); the API
 * is the sole source of live gate/terminal. Before this merge, those fields
 * were silently dropped when the airport object shadowed them.
 */
export function airportWithLive(
  airport: AirportRow | null,
  live: { terminal?: string; gate?: string }
): AirportInfo | undefined {
  if (!airport) return undefined;
  return {
    iata: airport.iata ?? undefined,
    icao: airport.icao ?? undefined,
    name: airport.name,
    lat: airport.lat,
    lon: airport.lon,
    terminal: live.terminal,
    gate: live.gate,
  };
}

/** Resolve both airports of a provider answer (either code may be absent). */
export async function resolveAirports(
  departureCode: string | undefined,
  arrivalCode: string | undefined
): Promise<[AirportRow | null, AirportRow | null]> {
  return Promise.all([
    departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
    arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
  ]);
}

/** AirLabs result for its first flight, times converted to UTC. */
export async function mapAirlabsResult(first: FlightData): Promise<FlightLookupResult> {
  const departureCode = first.departure.iata || first.departure.icao;
  const arrivalCode = first.arrival.iata || first.arrival.icao;
  const [departureAirport, arrivalAirport] = await resolveAirports(departureCode, arrivalCode);

  // Convert AirLabs times to UTC (AirLabs may return UTC or local times)
  const departureTimeRaw = first.departure.scheduledTime || first.departure.actualTime;
  const arrivalTimeRaw = first.arrival.scheduledTime || first.arrival.actualTime;
  const actualDepartureRaw = first.departure.actualTime;
  const actualArrivalRaw = first.arrival.actualTime;

  const [departureTimeUtc, arrivalTimeUtc, actualDepartureUtc, actualArrivalUtc] =
    await Promise.all([
      departureTimeRaw
        ? convertAirlabsTimeToUtc(departureTimeRaw, departureCode)
        : Promise.resolve(null),
      arrivalTimeRaw ? convertAirlabsTimeToUtc(arrivalTimeRaw, arrivalCode) : Promise.resolve(null),
      actualDepartureRaw
        ? convertAirlabsTimeToUtc(actualDepartureRaw, departureCode)
        : Promise.resolve(null),
      actualArrivalRaw
        ? convertAirlabsTimeToUtc(actualArrivalRaw, arrivalCode)
        : Promise.resolve(null),
    ]);

  return {
    source: "airlabs",
    airline:
      first.airline ||
      (first.airlineIata ? getAirlineName(first.airlineIata) || undefined : undefined) ||
      first.airlineIcao,
    flightNumber: first.flightNumber,
    aircraft: first.aircraft || first.aircraftIcao,
    departure: airportWithLive(departureAirport, first.departure),
    arrival: airportWithLive(arrivalAirport, first.arrival),
    departureTime: departureTimeUtc || undefined,
    arrivalTime: arrivalTimeUtc || undefined,
    actualDeparture: actualDepartureUtc || undefined,
    actualArrival: actualArrivalUtc || undefined,
  };
}

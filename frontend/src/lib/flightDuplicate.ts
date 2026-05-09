/**
 * Pure helper that turns an existing Flight into a `FlightInput`
 * payload suitable for `flightsApi.create` when the user duplicates a
 * row from the flights table.
 *
 * Extracted from FlightsTablePage so the page component stays under the
 * 800-line hard maximum.
 *
 * The duplicate is always created with status "duplicated" — a 5-value
 * status set (historical/scheduled/flown/cancelled/duplicated) that has
 * no time requirements on the backend. The user changes it to
 * "scheduled" in the edit modal once they pick real dates. Times are
 * deliberately not copied — they belong to a specific trip instance.
 */
import type { Flight, FlightInput } from "../types";

/** `null` → `undefined` — Zod `.optional()` rejects null on the backend,
 *  see project memory note about Zod nullable+optional. */
function nullToUndef<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

export function buildDuplicateInput(flight: Flight, mode: "return" | "same"): FlightInput {
  const depAirport = {
    iata: flight.depIata,
    icao: flight.depIcao,
    name: flight.depName,
    lat: flight.depLat,
    lon: flight.depLon,
  };
  const arrAirport = {
    iata: flight.arrIata,
    icao: flight.arrIcao,
    name: flight.arrName,
    lat: flight.arrLat,
    lon: flight.arrLon,
  };
  return {
    airline: nullToUndef(flight.airline),
    operatingAirline: nullToUndef(flight.operatingAirline),
    flightNumber: nullToUndef(flight.flightNumber),
    aircraft: nullToUndef(flight.aircraft),
    departure: mode === "return" ? arrAirport : depAirport,
    arrival: mode === "return" ? depAirport : arrAirport,
    status: "duplicated",
    category: nullToUndef(flight.category),
    tags: flight.tags ?? undefined,
    companions: flight.companions ?? undefined,
    notes: nullToUndef(flight.notes),
  };
}

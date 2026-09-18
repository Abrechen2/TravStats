/**
 * Airline code → name (and code → code) resolution for display purposes.
 *
 * All lookup tables are derived from `AIRLINE_CATALOG`
 * (`./generated/airlineCatalog.ts`), an auto-generated mirror of the
 * backend's single source of truth at `backend/src/data/airlines.ts`. Do
 * NOT hand-add entries here — regenerate the catalogue instead:
 *
 *   cd backend && npx tsx scripts/generate-airline-catalog.ts
 */
import type { AirlineResolvers } from "../shared/airlineNormalize";
import { AIRLINE_CATALOG } from "./generated/airlineCatalog";

/** IATA code (2 chars, e.g. "LH") → airline name. */
const AIRLINE_IATA_MAP: Record<string, string> = Object.fromEntries(
  AIRLINE_CATALOG.map((a) => [a.iata, a.name])
);

/** ICAO code (3 chars, e.g. "DLH") → airline name. */
const AIRLINE_ICAO_MAP: Record<string, string> = Object.fromEntries(
  AIRLINE_CATALOG.filter((a) => a.icao).map((a) => [a.icao as string, a.name])
);

/** ICAO code → IATA code, so a logo lookup (which wants IATA) can succeed. */
const AIRLINE_ICAO_TO_IATA_MAP: Record<string, string> = Object.fromEntries(
  AIRLINE_CATALOG.filter((a) => a.icao).map((a) => [a.icao as string, a.iata])
);

/** UPPERCASED airline name → IATA code, so stored free-text names ("Lufthansa")
 * can still feed a logo lookup even when no structured code was written. */
const AIRLINE_NAME_TO_IATA_MAP: Record<string, string> = Object.fromEntries(
  AIRLINE_CATALOG.map((a) => [a.name.toUpperCase(), a.iata])
);

/**
 * A flight designator: a two-character airline code carrying at least one
 * letter, then one to four digits, then an optional operational suffix
 * ("LH400", "4U8521", "U21234", "BA117A").
 *
 * The shape is checked because the first two characters alone are not a
 * carrier. Measured on the 2.7.0-beta.1 build, 2026-09-18: a row whose flight
 * number read "UAT2" was shown as "United Airlines", because "UA" is United
 * and nothing asked what followed it. That is worse than a wrong label —
 * `FlightReviewModal` writes the derived name into the record when the airline
 * field is empty, so the guess becomes stored data.
 */
const FLIGHT_DESIGNATOR_RE = /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/;

/**
 * Derive airline name from the IATA prefix of a flight number.
 * Returns null when the string is not a flight number, or the prefix is
 * unknown to the catalogue.
 */
export function getAirlineFromFlightNumber(flightNumber: string): string | null {
  if (!flightNumber) return null;
  // "LH 400" is a common spelling and is the same flight; the space is noise.
  const normalized = flightNumber.replace(/\s+/g, "").toUpperCase();
  if (!FLIGHT_DESIGNATOR_RE.test(normalized)) return null;
  return AIRLINE_IATA_MAP[normalized.slice(0, 2)] ?? null;
}

/**
 * The fields relevant to airline code resolution. Deliberately a small,
 * standalone shape (not imported from `types/index.ts`) so this module has
 * no dependency edge on the rest of the app's types — any object with a
 * subset of these fields (e.g. a `Flight`, a `FlightInput`, a lookup
 * result) can be passed directly.
 */
export interface AirlineCodeSource {
  airline?: string | null;
  airlineIata?: string | null;
  airlineIcao?: string | null;
  flightNumber?: string | null;
}

/**
 * Resolve a display-ready airline name. Prefers the backend's structured
 * `airlineIata` / `airlineIcao` columns (populated by the parser / flight
 * lookup services) over sniffing the free-text `airline` field, since the
 * free-text field can be stale, user-typed, or simply wrong while the
 * structured columns were resolved and validated at write time.
 *
 * Resolution order:
 *   1. Structured `airlineIata`, if it maps to a known IATA code
 *   2. Structured `airlineIcao`, if it maps to a known ICAO code
 *   3. Free-text `airline`: 2 chars → try IATA map, 3 chars → try ICAO map
 *   4. Free-text `airline` as-is (already a name, or an unknown code —
 *      degrades gracefully to showing the raw value rather than nothing)
 *   5. IATA prefix of the flight number
 *   6. null
 */
export function resolveAirlineDisplay(source: AirlineCodeSource): string | null {
  const { airline, airlineIata, airlineIcao, flightNumber } = source;

  if (airlineIata) {
    const resolved = AIRLINE_IATA_MAP[airlineIata.trim().toUpperCase()];
    if (resolved) return resolved;
  }
  if (airlineIcao) {
    const resolved = AIRLINE_ICAO_MAP[airlineIcao.trim().toUpperCase()];
    if (resolved) return resolved;
  }

  if (airline) {
    const trimmed = airline.trim();
    const upper = trimmed.toUpperCase();
    if (trimmed.length === 2) {
      const resolved = AIRLINE_IATA_MAP[upper];
      if (resolved) return resolved;
    } else if (trimmed.length === 3) {
      const resolved = AIRLINE_ICAO_MAP[upper];
      if (resolved) return resolved;
    }
    if (trimmed.length > 0) return trimmed;
  }

  if (flightNumber) {
    return getAirlineFromFlightNumber(flightNumber);
  }

  return null;
}

/**
 * Resolve the IATA code to feed a logo lookup (e.g. `<AirlineLogo iata={…}>`)
 * from whichever field carries it.
 *
 * Resolution order:
 *   1. Structured `airlineIata` / `airlineIcao` columns
 *   2. Code-shaped free-text `airline` value (2-char IATA / 3-char ICAO)
 *   3. Full airline NAME via the catalogue ("Lufthansa" → LH) — most stored
 *      flights only carry the name, no structured code
 *   4. Catalogue-KNOWN IATA prefix of the flight number ("LH2462" → LH).
 *      Unknown prefixes stay undefined so no wrong logo is ever requested.
 */
export function resolveAirlineIata(source: AirlineCodeSource): string | undefined {
  const { airline, airlineIata, airlineIcao, flightNumber } = source;

  if (airlineIata) {
    return airlineIata.trim().toUpperCase();
  }
  if (airlineIcao) {
    const mapped = AIRLINE_ICAO_TO_IATA_MAP[airlineIcao.trim().toUpperCase()];
    if (mapped) return mapped;
  }
  if (airline) {
    const trimmed = airline.trim().toUpperCase();
    if (trimmed.length === 2) return trimmed;
    if (trimmed.length === 3) {
      const mapped = AIRLINE_ICAO_TO_IATA_MAP[trimmed];
      if (mapped) return mapped;
    }
    const byName = AIRLINE_NAME_TO_IATA_MAP[trimmed];
    if (byName) return byName;
  }
  if (flightNumber) {
    const match = flightNumber
      .trim()
      .toUpperCase()
      .match(/^([A-Z]{2})\d/);
    if (match && AIRLINE_IATA_MAP[match[1]]) return match[1];
  }

  return undefined;
}

/**
 * The catalogue, in the shape `shared/airlineNormalize.ts` asks for — so
 * the KPI tile, the breakdown and the logbook header group airlines exactly
 * as the server's ranking does (forgejo#81).
 */
export const airlineResolvers: AirlineResolvers = {
  iataForName: (name) => resolveAirlineIata({ airline: name }),
  iataForIcao: (icao) => AIRLINE_ICAO_TO_IATA_MAP[icao.trim().toUpperCase()],
  nameForIata: (iata) => AIRLINE_IATA_MAP[iata.trim().toUpperCase()],
};

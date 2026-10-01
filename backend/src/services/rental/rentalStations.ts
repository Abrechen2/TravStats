import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { RentalStationInput } from "../../schemas/rental";
import { resolveZone } from "../../shared/time/zoneOf";
import { TzUnresolvedError } from "../../shared/time/errors";
import { countryFromCoordinates } from "../geo/countryFromCoordinates";
import { searchPlacesDetailed } from "../geo/photon";

/**
 * Station resolution for a rental (spec 2026-10-01-rental-domain-design §3.2).
 * There is no catalogue of rental counters; a station is placed, in order, by
 * a picked airport, a printed IATA code, a position the client already holds,
 * or an address the geocoder finds. A station none of them places is REFUSED:
 * a row without a position has no zone, no country and no map point, and
 * every fallback the codebase once had for that (the browser's zone, UTC, the
 * user's home) put a time or a pin somewhere false without a word.
 */

export type StationEnd = "pickup" | "return";

/** The columns one end of a rental carries. */
export interface ResolvedStation {
  name: string;
  address: string | null;
  airportId: number | null;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string;
}

/** The station names no place — the request is what is missing (422). */
export class RentalStationUnresolvedError extends AppError {
  constructor(field: string, reason: string) {
    super(
      `The rental station could not be placed: ${reason}`,
      422,
      "RENTAL_STATION_UNRESOLVED",
      field
    );
    this.name = "RentalStationUnresolvedError";
  }
}

/** The geocoder could not answer — never read as "no such place" (503). */
export class RentalGeocoderUnavailableError extends AppError {
  constructor(field: string) {
    super(
      "The address search is not answering; the station could not be placed",
      503,
      "RENTAL_GEOCODER_UNAVAILABLE",
      field
    );
    this.name = "RentalGeocoderUnavailableError";
  }
}

const AIRPORT_SELECT = { id: true, lat: true, lon: true, country: true, timezone: true } as const;
type AirportRow = {
  id: number;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string | null;
};

async function airportFor(input: RentalStationInput, field: string): Promise<AirportRow | null> {
  if (input.airportId != null) {
    const row = await prisma.airport.findUnique({
      where: { id: input.airportId },
      select: AIRPORT_SELECT,
    });
    if (!row)
      throw new RentalStationUnresolvedError(field, `no airport with id ${input.airportId}`);
    return row;
  }
  if (input.iata) {
    const row = await prisma.airport.findFirst({
      where: { iata: input.iata, isClosed: false },
      select: AIRPORT_SELECT,
    });
    if (!row) throw new RentalStationUnresolvedError(field, `no open airport ${input.iata}`);
    return row;
  }
  return null;
}

/** The first geocoder hit for an address; failure and "nothing found" kept apart. */
async function geocode(
  address: string,
  field: string
): Promise<{ lat: number; lon: number; country: string | null }> {
  const outcome = await searchPlacesDetailed(address, { limit: 1 });
  if (outcome.degraded) throw new RentalGeocoderUnavailableError(field);
  const hit = outcome.results[0];
  if (!hit) throw new RentalStationUnresolvedError(field, "the address search found nothing");
  return { lat: hit.lat, lon: hit.lon, country: hit.countryCode?.toUpperCase() ?? null };
}

function zoneAt(
  place: { catalogueZone?: string | null; lat: number; lon: number },
  field: string
): string {
  try {
    return resolveZone(place).zone;
  } catch (error) {
    if (error instanceof TzUnresolvedError) throw new TzUnresolvedError(error.message, field);
    throw error;
  }
}

/** Places one station, or refuses it — see the module comment for the order. */
export async function resolveRentalStation(
  input: RentalStationInput,
  field: string
): Promise<ResolvedStation> {
  const airport = await airportFor(input, field);
  if (airport) {
    return {
      name: input.name,
      address: input.address ?? null,
      airportId: airport.id,
      lat: airport.lat,
      lon: airport.lon,
      country: airport.country?.toUpperCase() ?? input.country ?? null,
      timezone: zoneAt(
        { catalogueZone: airport.timezone, lat: airport.lat, lon: airport.lon },
        field
      ),
    };
  }
  let position: { lat: number; lon: number; country: string | null };
  if (input.lat != null && input.lon != null) {
    position = { lat: input.lat, lon: input.lon, country: input.country ?? null };
  } else if (input.address) {
    position = await geocode(input.address, field);
  } else {
    throw new RentalStationUnresolvedError(field, "no airport, position or address");
  }
  // A country is read off the boundaries when nobody named one — derived from
  // the point, not guessed; null when the point lies in no country (at sea).
  const country = position.country ?? (await countryFromCoordinates(position.lat, position.lon));
  return {
    name: input.name,
    address: input.address ?? null,
    airportId: null,
    lat: position.lat,
    lon: position.lon,
    country,
    timezone: zoneAt(position, field),
  };
}

/** The pickup end's columns, prefixed for the row. */
export function pickupColumns(s: ResolvedStation) {
  return {
    pickupStationName: s.name,
    pickupAddress: s.address,
    pickupAirportId: s.airportId,
    pickupLat: s.lat,
    pickupLon: s.lon,
    pickupCountry: s.country,
    pickupTimezone: s.timezone,
  };
}

/** The return end's columns, prefixed for the row. */
export function returnColumns(s: ResolvedStation) {
  return {
    returnStationName: s.name,
    returnAddress: s.address,
    returnAirportId: s.airportId,
    returnLat: s.lat,
    returnLon: s.lon,
    returnCountry: s.country,
    returnTimezone: s.timezone,
  };
}

/** The stored station of one end, read back from a row. */
export function storedStation(
  row: {
    pickupStationName: string;
    pickupAddress: string | null;
    pickupAirportId: number | null;
    pickupLat: number;
    pickupLon: number;
    pickupCountry: string | null;
    pickupTimezone: string;
    returnStationName: string;
    returnAddress: string | null;
    returnAirportId: number | null;
    returnLat: number;
    returnLon: number;
    returnCountry: string | null;
    returnTimezone: string;
  },
  end: StationEnd
): ResolvedStation {
  return end === "pickup"
    ? {
        name: row.pickupStationName,
        address: row.pickupAddress,
        airportId: row.pickupAirportId,
        lat: row.pickupLat,
        lon: row.pickupLon,
        country: row.pickupCountry,
        timezone: row.pickupTimezone,
      }
    : {
        name: row.returnStationName,
        address: row.returnAddress,
        airportId: row.returnAirportId,
        lat: row.returnLat,
        lon: row.returnLon,
        country: row.returnCountry,
        timezone: row.returnTimezone,
      };
}

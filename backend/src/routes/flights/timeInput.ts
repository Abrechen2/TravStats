import type { TimePrecision } from "../../shared/time/wire";
import { zoneOf } from "../../shared/time/zoneOf";
import { getCachedAirports } from "../../services/airportCache";

/**
 * A flight's zones on the time model (ADR 0002 phase 2).
 *
 * A flight used not to keep its zone: the client's zone won on write and was
 * then thrown away, and every read joined the airport catalogue — so a
 * catalogue correction moved the displayed time of every past flight at that
 * airport. The zone each end was WRITTEN with is now stored, and re-derived
 * only when that end's airport changes (defect class 4: a re-derivation must
 * not destroy stored good data).
 *
 * Lives beside `routes/flights.ts` because that file is frozen at its size.
 */

type Body = Record<string, unknown>;
type End = "departure" | "arrival";

const ZONE_FIELDS: Record<
  End,
  { tz: string; actualTz: string; local: string; actualLocal: string }
> = {
  departure: {
    tz: "depTimezone",
    actualTz: "actualDepartureTz",
    local: "departureLocal",
    actualLocal: "actualDepartureLocal",
  },
  arrival: {
    tz: "arrTimezone",
    actualTz: "actualArrivalTz",
    local: "arrivalLocal",
    actualLocal: "actualArrivalLocal",
  },
};

export interface StoredFlightEnds {
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

const codeOf = (end: unknown, key: "iata" | "icao"): string | null => {
  const value = typeof end === "object" && end !== null ? (end as Body)[key] : undefined;
  return typeof value === "string" && value.length > 0 ? value.toUpperCase() : null;
};

/** Whether an UPDATE body names a different airport for this end. */
export function airportChanged(body: Body, end: End, stored: StoredFlightEnds): boolean {
  const sent = body[end];
  if (sent === undefined || sent === null) return false;
  const iata = codeOf(sent, "iata");
  const icao = codeOf(sent, "icao");
  const storedIata = (end === "departure" ? stored.depIata : stored.arrIata)?.toUpperCase() ?? null;
  const storedIcao = (end === "departure" ? stored.depIcao : stored.arrIcao)?.toUpperCase() ?? null;
  if (iata && storedIata) return iata !== storedIata;
  if (icao && storedIcao) return icao !== storedIcao;
  return iata !== storedIata || icao !== storedIcao;
}

const missing = (value: unknown): boolean => value === undefined || value === null || value === "";

/**
 * For an UPDATE: a wall clock sent without a zone, at an airport that did not
 * change, is read in the zone the flight was WRITTEN with — not the one the
 * catalogue holds today. Runs before `withAirportTimezones`, which fills the
 * rest from the catalogue. Returns a new body.
 */
export function withStoredZones<T>(rawBody: T, stored: StoredFlightEnds): T {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) return rawBody;
  const body = { ...(rawBody as Body) };
  for (const end of ["departure", "arrival"] as End[]) {
    const zone = end === "departure" ? stored.depTimezone : stored.arrTimezone;
    if (!zone || airportChanged(body, end, stored)) continue;
    const f = ZONE_FIELDS[end];
    if (!missing(body[f.local]) && missing(body[f.tz])) body[f.tz] = zone;
    if (!missing(body[f.actualLocal]) && missing(body[f.actualTz])) body[f.actualTz] = zone;
  }
  return body as T;
}

/** The catalogue's zone for an airport end, else its coordinates' zone, else null. */
async function zoneOfEndpoint(end: {
  iata?: string | null;
  icao?: string | null;
  lat: number;
  lon: number;
}): Promise<string | null> {
  const codes = [end.iata, end.icao].filter((c): c is string => Boolean(c));
  let catalogueZone: string | null = null;
  if (codes.length > 0) {
    const airports = await getCachedAirports(codes);
    catalogueZone =
      codes.map((c) => airports.get(c)?.timezone).find((z): z is string => Boolean(z)) ?? null;
  }
  return zoneOf({ catalogueZone, lat: end.lat, lon: end.lon });
}

/** A semantics tag as a precision (ADR 0002 wire vocabulary). */
export function precisionOf(
  semantics: string | null | undefined,
  hasTime: boolean
): TimePrecision | null {
  if (!hasTime) return null;
  if (semantics === "DATE_ONLY") return "day";
  if (semantics === "UNKNOWN") return "unknown";
  return "minute";
}

export interface FlightZoneColumns {
  depTimezone?: string | null;
  arrTimezone?: string | null;
  depPrecision?: TimePrecision | null;
  arrPrecision?: TimePrecision | null;
}

interface ZoneInput {
  departureLocal?: string | null;
  arrivalLocal?: string | null;
  depTimezone?: string | null;
  arrTimezone?: string | null;
  depTimeSemantics?: string | null;
  arrTimeSemantics?: string | null;
}

interface Endpoints {
  departure?: { iata?: string | null; icao?: string | null; lat: number; lon: number } | null;
  arrival?: { iata?: string | null; icao?: string | null; lat: number; lon: number } | null;
}

/**
 * The zone and precision columns for a write. An end whose wall clock was
 * sent stores the zone it was converted with; an end whose airport is new
 * (every end on create) stores that airport's zone; anything else is left
 * out, so an edit of the seat keeps the zone the flight was written with.
 */
export async function flightZoneColumns(
  data: ZoneInput,
  endpoints: Endpoints,
  stored?: {
    depTimeSemantics: string;
    arrTimeSemantics: string;
    departureTime: Date | null;
    arrivalTime: Date | null;
  }
): Promise<FlightZoneColumns> {
  const out: FlightZoneColumns = {};
  const ends = [
    [
      "departure",
      data.departureLocal,
      data.depTimezone,
      data.depTimeSemantics,
      "depTimezone",
      "depPrecision",
    ],
    [
      "arrival",
      data.arrivalLocal,
      data.arrTimezone,
      data.arrTimeSemantics,
      "arrTimezone",
      "arrPrecision",
    ],
  ] as const;
  for (const [end, local, zone, semantics, zoneKey, precisionKey] of ends) {
    if (local !== undefined) {
      out[zoneKey] = local ? (zone ?? null) : null;
      out[precisionKey] = precisionOf(semantics ?? "UTC", Boolean(local));
    } else if (endpoints[end]) {
      out[zoneKey] = await zoneOfEndpoint(endpoints[end]!);
    }
    if (local === undefined && semantics !== undefined && stored) {
      const hasTime = Boolean(end === "departure" ? stored.departureTime : stored.arrivalTime);
      out[precisionKey] = precisionOf(semantics, hasTime);
    }
  }
  return out;
}

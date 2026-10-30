import { zoneOf } from "../shared/time/zoneOf";
import { Prisma } from "../prisma";
import { prisma } from "../db";
import logger from "../utils/logger";
import { getCachedAirport, invalidateAirportCache, compareAirportAuthority } from "./airportCache";

export interface AirportData {
  iata?: string | null;
  icao?: string | null;
  name: string;
  city?: string | null;
  country?: string | null;
  lat: number;
  lon: number;
  altitude?: number | null;
  timezone?: string | null;
  /**
   * The city the airport SERVES, from AeroDataBox — as opposed to `city`, which
   * is OurAirports' municipality (the town the runway sits in). Backfilled only
   * as a side effect of a flight lookup, so it is usually null. See
   * `utils/airportDisplay.ts`.
   */
  municipalityName?: string | null;
}

interface ExternalAirportData {
  iata?: string;
  icao?: string;
  name: string;
  city?: string;
  country?: string;
  lat: number;
  lon: number;
  altitude?: number;
}

/** How long a downloaded OurAirports index stays valid. */
const CSV_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
/** How long a code that no source knew is remembered (a typo is retried rarely, not never). */
const MISS_CACHE_TTL = 10 * 60 * 1000;
/** Upper bound for any single outbound request of the lookup. */
const EXTERNAL_FETCH_TIMEOUT_MS = 8_000;
/** The CSV is ~12 MB, so it gets more room than a one-record API call. */
const CSV_FETCH_TIMEOUT_MS = 30_000;

/** OurAirports rows by upper-cased IATA and ICAO code, parsed once per download. */
let csvIndex: { rows: Map<string, ExternalAirportData>; timestamp: number } | null = null;
/** The download+parse in flight, shared by every concurrent miss. */
let csvIndexLoading: Promise<Map<string, ExternalAirportData>> | null = null;
const missCache = new Map<string, number>();
/** Hard bound on remembered misses; the oldest entry goes first (Map keeps insertion order). */
const MISS_CACHE_MAX = 1000;
/** An IATA (3) or ICAO (4) code. Anything else cannot be an airport and never goes upstream. */
const AIRPORT_CODE_SHAPE = /^[A-Z0-9]{3,4}$/;

function rememberMiss(code: string): void {
  const now = Date.now();
  missCache.delete(code);
  for (const [key, at] of missCache) {
    if (now - at >= MISS_CACHE_TTL) missCache.delete(key);
    else break; // insertion order is time order, so the rest are younger
  }
  while (missCache.size >= MISS_CACHE_MAX) {
    const oldest = missCache.keys().next().value;
    if (oldest === undefined) break;
    missCache.delete(oldest);
  }
  missCache.set(code, now);
}

/** Test seam: how many misses are remembered. */
export function missCacheSizeForTests(): number {
  return missCache.size;
}

/** Why an external lookup could not give an answer (as opposed to "no such airport"). */
export type AirportLookupFailureReason = "timeout" | "network" | "http_error";

export type AirportLookupResult =
  | { status: "found"; airport: AirportData }
  | { status: "not_found" }
  | { status: "unavailable"; reason: AirportLookupFailureReason };

type ExternalLookup =
  | { status: "found"; data: ExternalAirportData }
  | { status: "not_found" }
  | { status: "unavailable"; reason: AirportLookupFailureReason };

class ExternalFetchError extends Error {
  constructor(
    readonly reason: AirportLookupFailureReason,
    message: string
  ) {
    super(message);
  }
}

function failureReason(error: unknown): AirportLookupFailureReason {
  if (error instanceof ExternalFetchError) return error.reason;
  // By name, not instanceof: a DOMException from AbortSignal.timeout is not
  // always an `Error` of this realm.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  return "network";
}

/** Test seam: forget every cached download, parse and miss. */
export function resetAirportLookupCaches(): void {
  csvIndex = null;
  csvIndexLoading = null;
  missCache.clear();
}

/**
 * Parse a CSV line handling quoted fields that may contain commas
 * Example: "123","ABC","Large Airport","Berlin, Germany",52.5,13.4
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // Toggle quote state
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      // End of field
      result.push(current);
      current = "";
    } else {
      // Regular character
      current += char;
    }
  }

  // Add last field
  result.push(current);

  return result;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 * Returns distance in kilometers
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * The stored airport for a code, or null.
 *
 * Prefers the active airport when a closed predecessor shares the same
 * IATA/ICAO (Munich Airport vs. Munich-Riem, both EDDM/MUC), and a real ICAO
 * over a synthetic US-#### placeholder — see `compareAirportAuthority`.
 *
 * A function rather than inline code because the create path has to repeat
 * this read after losing a race, and the two must pick the same row.
 */
async function readStoredAirport(upperCode: string): Promise<AirportData | null> {
  const candidates = await prisma.airport.findMany({
    where: { OR: [{ iata: upperCode }, { icao: upperCode }] },
  });
  return [...candidates].sort(compareAirportAuthority)[0] ?? null;
}

/**
 * Is this code already ours? Cache first, then the table — and the table read
 * is not optional.
 *
 * `getCachedAirport` NEGATIVE-caches a miss for five minutes, so a row seeded,
 * imported or created by another request in that window is invisible to the
 * cache alone. The re-read is what catches it, and it has to be here rather
 * than inlined at each caller: `findOrCreateAirport` below would otherwise
 * fetch and insert a row the table already holds, and the demo branch of
 * `GET /airports/:code` (routes/airports.ts) would answer 404 for an airport
 * every other account can see. Both ask the same question, so both ask it
 * through this one function.
 *
 * Never writes and never reaches the network — that is the whole difference
 * from `findOrCreateAirport`.
 */
export async function findExistingAirport(code: string): Promise<AirportData | null> {
  const upperCode = code.toUpperCase();
  return (await getCachedAirport(upperCode)) ?? (await readStoredAirport(upperCode));
}

/**
 * Sucht einen Flughafen in der lokalen DB oder lädt ihn von externen Quellen
 */
export async function findOrCreateAirport(code: string): Promise<AirportData | null> {
  const result = await lookupOrCreateAirport(code);
  return result.status === "found" ? result.airport : null;
}

/**
 * `findOrCreateAirport` with the reason a miss happened. "No source knows this
 * code" and "the sources could not be asked" are different answers — the
 * second is worth a retry and must not read as a 404 to the user.
 */
export async function lookupOrCreateAirport(code: string): Promise<AirportLookupResult> {
  const upperCode = code.toUpperCase();

  // 1. Cache, then the table — see `findExistingAirport` for why the second
  //    read is not redundant with the first.
  const existingAirport = await findExistingAirport(upperCode);

  if (existingAirport) {
    return { status: "found", airport: existingAirport };
  }

  if (!AIRPORT_CODE_SHAPE.test(upperCode)) {
    return { status: "not_found" };
  }

  const missedAt = missCache.get(upperCode);
  if (missedAt !== undefined) {
    if (Date.now() - missedAt < MISS_CACHE_TTL) return { status: "not_found" };
    missCache.delete(upperCode);
  }

  logger.debug({
    operation: "airport_lookup_external",
    message: `Airport ${code} not found locally, searching external sources`,
    context: { code },
  });

  // 2. Von externer API laden
  const external = await fetchFromExternalAPI(upperCode);

  if (external.status === "unavailable") {
    return external;
  }
  if (external.status === "not_found") {
    rememberMiss(upperCode);
    return external;
  }
  const externalData = external.data;

  // 3. In DB speichern
  // Derive timezone from coordinates using geo-tz
  const derivedTimezone = deriveTimezone(externalData.lat, externalData.lon);

  logger.info({
    operation: "airport_lookup_store",
    message: `Storing new airport: ${externalData.name} (${code})`,
    context: { code, airportName: externalData.name, timezone: derivedTimezone },
  });

  // The check above and this create are not atomic, and an import resolves its
  // airports concurrently — so two requests for the SAME unseen code both find
  // nothing and both insert. `(iata, isClosed)` and `(icao, isClosed)` are
  // unique, so the loser used to get P2002 and fail a perfectly valid import
  // (AUD-091). A lost race is not an error: the row it wanted now exists, so
  // it is read and returned. Read through the same helper as the first check,
  // or the two could disagree about which row wins a code collision.
  let newAirport: AirportData;
  try {
    newAirport = await prisma.airport.create({
      data: {
        iata: externalData.iata || null,
        icao: externalData.icao || null,
        name: externalData.name,
        city: externalData.city || null,
        country: externalData.country || null,
        lat: externalData.lat,
        lon: externalData.lon,
        altitude: externalData.altitude || null,
        timezone: derivedTimezone,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const raced = await readStoredAirport(upperCode);
    if (!raced) throw error;
    logger.info({
      operation: "airport_lookup_race_resolved",
      message: `Another request stored ${upperCode} first; using that row`,
      context: { code: upperCode, airportName: raced.name },
    });
    return { status: "found", airport: raced };
  }

  // Invalidate cache so new airport is cached on next lookup
  if (newAirport.iata) {
    invalidateAirportCache(newAirport.iata);
  }
  if (newAirport.icao) {
    invalidateAirportCache(newAirport.icao);
  }

  return { status: "found", airport: newAirport };
}

/**
 * Backfill `shortName` and/or `municipalityName` on an existing airport row
 * when a provider lookup (currently AeroDataBox) returns those fields.
 *
 * Only fills in NULL slots — never overwrites a curated value. No-op when
 * both target fields are already populated or no enrichment data is passed.
 *
 * Returns true when an UPDATE was issued (caller can use this for logging /
 * metrics); false when nothing changed.
 */
export async function enrichAirportMetadata(
  code: string,
  data: { shortName?: string | null; municipalityName?: string | null }
): Promise<boolean> {
  const incomingShort = data.shortName?.trim();
  const incomingMunicipality = data.municipalityName?.trim();
  if (!incomingShort && !incomingMunicipality) return false;

  const upperCode = code.toUpperCase();
  const airport = await prisma.airport.findFirst({
    where: { OR: [{ iata: upperCode }, { icao: upperCode }] },
    orderBy: { isClosed: "asc" },
    select: { id: true, iata: true, icao: true, shortName: true, municipalityName: true },
  });
  if (!airport) return false;

  const patch: { shortName?: string; municipalityName?: string } = {};
  if (incomingShort && !airport.shortName) patch.shortName = incomingShort;
  if (incomingMunicipality && !airport.municipalityName)
    patch.municipalityName = incomingMunicipality;
  if (Object.keys(patch).length === 0) return false;

  await prisma.airport.update({ where: { id: airport.id }, data: patch });

  if (airport.iata) invalidateAirportCache(airport.iata);
  if (airport.icao) invalidateAirportCache(airport.icao);

  logger.info({
    operation: "airport_metadata_enriched",
    message: `Backfilled metadata for ${code}: ${Object.keys(patch).join(", ")}`,
    context: { code, fields: Object.keys(patch) },
  });

  return true;
}

/**
 * Parse the OurAirports CSV once into a code -> row map. Rows without usable
 * coordinates are left out, so a code resolves to the first row that has some.
 */
function buildCsvIndex(csvText: string): Map<string, ExternalAirportData> {
  const rows = new Map<string, ExternalAirportData>();
  const lines = csvText.split("\n");
  // OurAirports CSV format:
  // 0: id, 1: ident (ICAO), 2: type, 3: name, 4: latitude_deg, 5: longitude_deg,
  // 6: elevation_ft, 7: continent, 8: iso_country, 9: iso_region, 10: municipality,
  // 11: scheduled_service, 12: gps_code (ICAO backup), 13: iata_code, 14: local_code
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = parseCSVLine(line);
    const iataCode = parts[13]?.trim() || "";
    const icaoCode = parts[1]?.trim() || parts[12]?.trim() || "";
    if (!iataCode && !icaoCode) continue;
    const lat = parseFloat(parts[4]);
    const lon = parseFloat(parts[5]);
    if (isNaN(lat) || isNaN(lon)) continue;
    const entry: ExternalAirportData = {
      iata: iataCode || undefined,
      icao: icaoCode || undefined,
      name: parts[3]?.trim() || iataCode || icaoCode,
      city: parts[10]?.trim() || undefined,
      country: parts[8]?.trim() || undefined,
      lat,
      lon,
      altitude: parts[6] ? Math.round(parseFloat(parts[6]) * 0.3048) : undefined,
    };
    for (const key of [iataCode.toUpperCase(), icaoCode.toUpperCase()]) {
      if (key && !rows.has(key)) rows.set(key, entry);
    }
  }
  return rows;
}

async function downloadCsvIndex(): Promise<Map<string, ExternalAirportData>> {
  logger.info({
    operation: "airport_lookup_csv_download",
    message: "Downloading OurAirports CSV data",
  });
  const response = await fetch(`https://davidmegginson.github.io/ourairports-data/airports.csv`, {
    signal: AbortSignal.timeout(CSV_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ExternalFetchError("http_error", `HTTP ${response.status}`);
  }
  const csvText = await response.text();
  const rows = buildCsvIndex(csvText);
  csvIndex = { rows, timestamp: Date.now() };
  logger.info({
    operation: "airport_lookup_csv_cached",
    message: `CSV data indexed (${rows.size} codes)`,
    context: { codes: rows.size },
  });
  return rows;
}

/** The parsed index: cached for a day, and one download+parse however many callers miss at once. */
function loadCsvIndex(): Promise<Map<string, ExternalAirportData>> {
  if (csvIndex && Date.now() - csvIndex.timestamp < CSV_CACHE_TTL) {
    return Promise.resolve(csvIndex.rows);
  }
  if (!csvIndexLoading) {
    csvIndexLoading = downloadCsvIndex().finally(() => {
      csvIndexLoading = null;
    });
  }
  return csvIndexLoading;
}

/**
 * Lädt Flughafendaten von externen APIs
 * Verwendet mehrere Fallback-Quellen
 *
 * "Not found" is only answered when a source actually said so. When every
 * source failed (timeout, network, HTTP error) the result is `unavailable`
 * with the reason, so the caller can tell the user to retry.
 */
async function fetchFromExternalAPI(code: string): Promise<ExternalLookup> {
  // Versuche zuerst die kostenlose Airport-Codes API
  try {
    const response = await fetch(`https://www.airport-data.com/api/ap_info.json?iata=${code}`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;

      if (data && data.latitude && data.longitude) {
        return {
          status: "found",
          data: {
            iata: (typeof data.iata === "string" ? data.iata : code) || code,
            icao: typeof data.icao === "string" ? data.icao : undefined,
            name: typeof data.name === "string" ? data.name : code,
            city: typeof data.location === "string" ? data.location : undefined,
            country: typeof data.country === "string" ? data.country : undefined,
            lat: parseFloat(String(data.latitude)),
            lon: parseFloat(String(data.longitude)),
            altitude: data.elevation_ft
              ? Math.round(parseFloat(String(data.elevation_ft)) * 0.3048)
              : undefined,
          },
        };
      }
    }
  } catch (error) {
    logger.debug({
      operation: "airport_lookup_api_failed",
      message: `Airport-data.com API failed for ${code}`,
      context: { code, reason: failureReason(error) },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }

  // Fallback: OurAirports, parsed once into a map
  try {
    const rows = await loadCsvIndex();
    const hit = rows.get(code);
    if (hit) return { status: "found", data: hit };
    return { status: "not_found" };
  } catch (error) {
    const reason = failureReason(error);
    logger.error({
      operation: "airport_lookup_csv_error",
      message: `OurAirports CSV lookup failed for ${code}`,
      context: { code, reason },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    // The CSV could not be read, so even if the first API answered without a
    // record the question is unanswered, not a miss.
    return { status: "unavailable", reason };
  }
}

/**
 * Find nearest airport by coordinates
 * Returns the closest OPEN airport within maxDistance km
 *
 * Closed airfields are excluded, never merely down-ranked. Proximity alone is
 * a poor authority signal: OurAirports carries decommissioned strips and
 * heliports that sit closer to a coarse coordinate than the international
 * airport it actually denotes — a 1-decimal JFK coordinate lands nearer the
 * closed Rockaway Airport (NOLF) than JFK itself, and a 1-decimal LAX one
 * nearer the closed Hughes heliport (US-11178). A closed field is never a
 * valid answer, so returning nothing beats returning a plausible wrong one.
 */
export async function findNearestAirport(
  lat: number,
  lon: number,
  maxDistance: number = 5
): Promise<AirportData | null> {
  // Get all airports within rough bounding box (performance optimization)
  const latRange = maxDistance / 111; // ~111km per degree latitude
  // Near a pole a degree of longitude shrinks to nothing, so the range would
  // blow up past the whole globe: keep it a valid longitude span.
  const lonRange = Math.min(
    180,
    maxDistance / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  );

  const airports = await prisma.airport.findMany({
    where: {
      isClosed: false,
      lat: {
        gte: lat - latRange,
        lte: lat + latRange,
      },
      lon: {
        gte: lon - lonRange,
        lte: lon + lonRange,
      },
    },
  });

  // Find closest airport within maxDistance
  let closest: AirportData | null = null;
  let minDistance = maxDistance;

  for (const airport of airports) {
    const distance = calculateDistance(lat, lon, airport.lat, airport.lon);
    if (distance < minDistance) {
      minDistance = distance;
      closest = airport as AirportData;
    }
  }

  return closest;
}

/**
 * Enrich airport data - try multiple strategies to find missing info
 */
export async function enrichAirportData(
  airportData: Partial<AirportData>
): Promise<AirportData | null> {
  // Strategy 1: Lookup by IATA code
  if (airportData.iata) {
    const airport = await findOrCreateAirport(airportData.iata);
    if (airport) return airport as AirportData;
  }

  // Strategy 2: Lookup by ICAO code
  if (airportData.icao) {
    const airport = await findOrCreateAirport(airportData.icao);
    if (airport) return airport as AirportData;
  }

  // Strategy 3: Lookup by coordinates (nearest airport within 5km)
  if (airportData.lat !== undefined && airportData.lon !== undefined) {
    const airport = await findNearestAirport(airportData.lat, airportData.lon, 5);
    if (airport) return airport;
  }

  // No match found
  return null;
}

/**
 * Enrich flight data with missing airport information
 * Returns enriched departure and arrival airport data
 */
export async function enrichFlightAirports(flightData: {
  departure: Partial<AirportData>;
  arrival: Partial<AirportData>;
}): Promise<{
  departure: AirportData;
  arrival: AirportData;
}> {
  // Enrich departure airport
  let enrichedDeparture = flightData.departure;
  const foundDeparture = await enrichAirportData(flightData.departure);
  if (foundDeparture) {
    enrichedDeparture = {
      // Keep existing data, fill in missing fields
      ...foundDeparture,
      ...flightData.departure,
      // Override with database data if original was missing
      iata: flightData.departure.iata || foundDeparture.iata,
      icao: flightData.departure.icao || foundDeparture.icao,
      name: flightData.departure.name || foundDeparture.name,
      city: flightData.departure.city || foundDeparture.city,
      country: flightData.departure.country || foundDeparture.country,
      // The catalogue OWNS the position — it is not a gap-filler here.
      // This used to read `flightData.departure.lat ?? foundDeparture.lat`,
      // which let every caller win, and every import path brings a coordinate:
      // the e-mail parser, the boarding-pass scan, a live provider update, the
      // manual form. Providers quote different reference points for one airport
      // (terminal vs. ARP vs. runway threshold), so the stored copies drifted
      // apart and never converged — measured at 242 of 878 airport references
      // on a real account, across 30 airports, the worst 1.6 km out. The caller
      // still supplies the position for an airport the catalogue does not know,
      // because then there is no other.
      lat: foundDeparture.lat ?? flightData.departure.lat,
      lon: foundDeparture.lon ?? flightData.departure.lon,
      altitude: flightData.departure.altitude ?? foundDeparture.altitude,
      timezone: flightData.departure.timezone || foundDeparture.timezone,
    };
  }

  // Enrich arrival airport
  let enrichedArrival = flightData.arrival;
  const foundArrival = await enrichAirportData(flightData.arrival);
  if (foundArrival) {
    enrichedArrival = {
      // Keep existing data, fill in missing fields
      ...foundArrival,
      ...flightData.arrival,
      // Override with database data if original was missing
      iata: flightData.arrival.iata || foundArrival.iata,
      icao: flightData.arrival.icao || foundArrival.icao,
      name: flightData.arrival.name || foundArrival.name,
      city: flightData.arrival.city || foundArrival.city,
      country: flightData.arrival.country || foundArrival.country,
      // Same authority rule as the departure above.
      lat: foundArrival.lat ?? flightData.arrival.lat,
      lon: foundArrival.lon ?? flightData.arrival.lon,
      altitude: flightData.arrival.altitude ?? foundArrival.altitude,
      timezone: flightData.arrival.timezone || foundArrival.timezone,
    };
  }

  return {
    departure: enrichedDeparture as AirportData,
    arrival: enrichedArrival as AirportData,
  };
}

/**
 * Derive IANA timezone string from coordinates using geo-tz.
 * Returns null if no timezone can be determined.
 */
export function deriveTimezone(lat: number, lon: number): string | null {
  // Null for a coordinate off the globe; a broken lookup THROWS, so neither
  // the backfill nor the one-time repair can record "done" over nothing.
  return zoneOf({ lat, lon });
}

/**
 * Backfill timezone for all airports in the database that are missing it.
 * Uses geo-tz to derive timezone from coordinates.
 * Returns the number of airports updated.
 */
export async function backfillAirportTimezones(): Promise<number> {
  const airports = await prisma.airport.findMany({
    where: { timezone: null },
    select: { id: true, iata: true, icao: true, lat: true, lon: true },
  });

  if (airports.length === 0) {
    logger.info({
      operation: "airport_timezone_backfill",
      message: "All airports already have timezone data",
    });
    return 0;
  }

  logger.info({
    operation: "airport_timezone_backfill",
    message: `Backfilling timezone for ${airports.length} airports`,
  });

  let updated = 0;
  for (const airport of airports) {
    const tz = deriveTimezone(airport.lat, airport.lon);
    if (tz) {
      await prisma.airport.update({
        where: { id: airport.id },
        data: { timezone: tz },
      });
      updated++;
    } else {
      logger.warn({
        operation: "airport_timezone_backfill",
        message: `Could not derive timezone for airport ${airport.iata || airport.icao}`,
        context: { lat: airport.lat, lon: airport.lon },
      });
    }
  }

  logger.info({
    operation: "airport_timezone_backfill",
    message: `Backfill complete: ${updated}/${airports.length} airports updated`,
  });

  return updated;
}

/**
 * Every catalogue row of the city a code belongs to, closed ones included and
 * rows without a code left out — the input `preferNamedAirports` (#287) needs
 * to tell "Berlin-Schönefeld" (SXF, closed) from the city code BER. The city
 * is read off the code's own rows; an unknown code has no city and yields
 * nothing, so the caller changes nothing.
 */
export async function airportsInCityOf(code: string): Promise<
  Array<{
    iata: string | null;
    icao: string | null;
    name: string;
    city: string | null;
    isClosed: boolean;
  }>
> {
  const upper = code.toUpperCase();
  const own = await prisma.airport.findMany({
    where: { OR: [{ iata: upper }, { icao: upper }] },
    select: { city: true },
  });
  const cities = [
    ...new Set(own.map((row) => row.city).filter((city): city is string => Boolean(city))),
  ];
  if (cities.length === 0) return [];
  return prisma.airport.findMany({
    where: { city: { in: cities }, iata: { not: null } },
    select: { iata: true, icao: true, name: true, city: true, isClosed: true },
  });
}

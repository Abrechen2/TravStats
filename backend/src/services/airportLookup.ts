import { find as findTimezone } from 'geo-tz';
import { prisma } from '../db';
import logger from '../utils/logger';
import { getCachedAirport, invalidateAirportCache, compareAirportAuthority } from './airportCache';

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

// In-memory cache for OurAirports CSV data (24 hour TTL)
interface CsvCache {
  data: string | null;
  timestamp: number;
}

const CSV_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let csvCache: CsvCache = { data: null, timestamp: 0 };

/**
 * Parse a CSV line handling quoted fields that may contain commas
 * Example: "123","ABC","Large Airport","Berlin, Germany",52.5,13.4
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // Toggle quote state
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current);
      current = '';
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
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Sucht einen Flughafen in der lokalen DB oder lädt ihn von externen Quellen
 */
export async function findOrCreateAirport(code: string): Promise<AirportData | null> {
  const upperCode = code.toUpperCase();

  // 1. Try cache first
  const cachedAirport = await getCachedAirport(upperCode);
  if (cachedAirport) {
    return cachedAirport;
  }

  // 2. If not in cache, check database (cache will be populated by getCachedAirport if found)
  // This handles the case where cache returned null but airport might exist
  // Prefer the active airport when a closed predecessor shares the same
  // IATA/ICAO (e.g. Munich Airport vs. Munich-Riem, both EDDM/MUC).
  const candidates = await prisma.airport.findMany({
    where: {
      OR: [
        { iata: upperCode },
        { icao: upperCode },
      ],
    },
  });
  // Prefer the authoritative airport on a code collision: active over closed,
  // and a real ICAO over a synthetic US-#### placeholder (see
  // compareAirportAuthority).
  const existingAirport = [...candidates].sort(compareAirportAuthority)[0] ?? null;

  if (existingAirport) {
    return existingAirport;
  }

  logger.debug({
    operation: 'airport_lookup_external',
    message: `Airport ${code} not found locally, searching external sources`,
    context: { code },
  });

  // 2. Von externer API laden
  const externalData = await fetchFromExternalAPI(upperCode);

  if (!externalData) {
    return null;
  }

  // 3. In DB speichern
  // Derive timezone from coordinates using geo-tz
  const derivedTimezone = deriveTimezone(externalData.lat, externalData.lon);

  logger.info({
    operation: 'airport_lookup_store',
    message: `Storing new airport: ${externalData.name} (${code})`,
    context: { code, airportName: externalData.name, timezone: derivedTimezone },
  });

  const newAirport = await prisma.airport.create({
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

  // Invalidate cache so new airport is cached on next lookup
  if (newAirport.iata) {
    invalidateAirportCache(newAirport.iata);
  }
  if (newAirport.icao) {
    invalidateAirportCache(newAirport.icao);
  }

  return newAirport;
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
  data: { shortName?: string | null; municipalityName?: string | null },
): Promise<boolean> {
  const incomingShort = data.shortName?.trim();
  const incomingMunicipality = data.municipalityName?.trim();
  if (!incomingShort && !incomingMunicipality) return false;

  const upperCode = code.toUpperCase();
  const airport = await prisma.airport.findFirst({
    where: { OR: [{ iata: upperCode }, { icao: upperCode }] },
    orderBy: { isClosed: 'asc' },
    select: { id: true, iata: true, icao: true, shortName: true, municipalityName: true },
  });
  if (!airport) return false;

  const patch: { shortName?: string; municipalityName?: string } = {};
  if (incomingShort && !airport.shortName) patch.shortName = incomingShort;
  if (incomingMunicipality && !airport.municipalityName) patch.municipalityName = incomingMunicipality;
  if (Object.keys(patch).length === 0) return false;

  await prisma.airport.update({ where: { id: airport.id }, data: patch });

  if (airport.iata) invalidateAirportCache(airport.iata);
  if (airport.icao) invalidateAirportCache(airport.icao);

  logger.info({
    operation: 'airport_metadata_enriched',
    message: `Backfilled metadata for ${code}: ${Object.keys(patch).join(', ')}`,
    context: { code, fields: Object.keys(patch) },
  });

  return true;
}

/**
 * Lädt Flughafendaten von externen APIs
 * Verwendet mehrere Fallback-Quellen
 */
async function fetchFromExternalAPI(code: string): Promise<ExternalAirportData | null> {
  // Versuche zuerst die kostenlose Airport-Codes API
  try {
    const response = await fetch(
      `https://www.airport-data.com/api/ap_info.json?iata=${code}`
    );

    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;

      if (data && data.latitude && data.longitude) {
        return {
          iata: (typeof data.iata === 'string' ? data.iata : code) || code,
          icao: typeof data.icao === 'string' ? data.icao : undefined,
          name: typeof data.name === 'string' ? data.name : code,
          city: typeof data.location === 'string' ? data.location : undefined,
          country: typeof data.country === 'string' ? data.country : undefined,
          lat: parseFloat(String(data.latitude)),
          lon: parseFloat(String(data.longitude)),
          altitude: data.elevation_ft ? Math.round(parseFloat(String(data.elevation_ft)) * 0.3048) : undefined,
        };
      }
    }
  } catch (error) {
    logger.debug({
      operation: 'airport_lookup_api_failed',
      message: `Airport-data.com API failed for ${code}`,
      context: { code },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }

  // Fallback: Versuche OurAirports direkten Lookup mit Cache
  try {
    let csvText: string;
    const now = Date.now();

    // Check if cache is valid
    if (csvCache.data && (now - csvCache.timestamp) < CSV_CACHE_TTL) {
      const cacheAge = Math.round((now - csvCache.timestamp) / 1000 / 60);
      logger.debug({
        operation: 'airport_lookup_csv_cache',
        message: `Using cached OurAirports data (age: ${cacheAge}min)`,
        context: { cacheAgeMinutes: cacheAge },
      });
      csvText = csvCache.data;
    } else {
      logger.info({
        operation: 'airport_lookup_csv_download',
        message: 'Downloading OurAirports CSV data',
      });
      const response = await fetch(
        `https://davidmegginson.github.io/ourairports-data/airports.csv`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      csvText = await response.text();

      // Update cache
      csvCache = {
        data: csvText,
        timestamp: now,
      };
      const csvSizeMB = (csvText.length / 1024 / 1024).toFixed(2);
      logger.info({
        operation: 'airport_lookup_csv_cached',
        message: `CSV data cached (${csvSizeMB}MB)`,
        context: { sizeMB: parseFloat(csvSizeMB) },
      });
    }

    const lines = csvText.split('\n');
    logger.debug({
      operation: 'airport_lookup_csv_search',
      message: `Searching ${lines.length} airports for code: ${code}`,
      context: { code, lineCount: lines.length },
    });

    // Finde die Zeile mit dem gesuchten Code
    let foundLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip header line
      if (i === 0 || !line.trim()) continue;

      // Proper CSV parsing: handle quoted fields that may contain commas
      const parts = parseCSVLine(line);

      // OurAirports CSV format:
      // 0: id, 1: ident (ICAO), 2: type, 3: name, 4: latitude_deg, 5: longitude_deg,
      // 6: elevation_ft, 7: continent, 8: iso_country, 9: iso_region, 10: municipality,
      // 11: scheduled_service, 12: gps_code (ICAO backup), 13: iata_code, 14: local_code

      const iataCode = parts[13]?.trim() || '';
      const icaoCode = parts[1]?.trim() || parts[12]?.trim() || '';

      // Case-insensitive comparison
      if (iataCode.toUpperCase() === code || icaoCode.toUpperCase() === code) {
        foundLine = i + 1;
        logger.debug({
          operation: 'airport_lookup_csv_found',
          message: `Found airport in CSV (line ${foundLine})`,
          context: {
            code,
            line: foundLine,
            iata: iataCode,
            icao: icaoCode,
            name: parts[3],
            city: parts[10],
            country: parts[8],
            coordinates: `${parts[4]}, ${parts[5]}`,
          },
        });

        const lat = parseFloat(parts[4]);
        const lon = parseFloat(parts[5]);

        if (isNaN(lat) || isNaN(lon)) {
          logger.warn({
            operation: 'airport_lookup_csv_invalid_coords',
            message: `Invalid coordinates for ${code}, skipping`,
            context: { code, lat: parts[4], lon: parts[5] },
          });
          continue;
        }

        return {
          iata: iataCode || undefined,
          icao: icaoCode || undefined,
          name: parts[3]?.trim() || code,
          city: parts[10]?.trim() || undefined,
          country: parts[8]?.trim() || undefined,
          lat,
          lon,
          altitude: parts[6] ? Math.round(parseFloat(parts[6]) * 0.3048) : undefined,
        };
      }
    }

    if (foundLine === 0) {
      logger.debug({
        operation: 'airport_lookup_csv_not_found',
        message: `Code ${code} not found in CSV`,
        context: { code, linesChecked: lines.length },
      });
    }
  } catch (error) {
    logger.error({
      operation: 'airport_lookup_csv_error',
      message: `OurAirports CSV lookup failed for ${code}`,
      context: { code },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  }

  logger.debug({
    operation: 'airport_lookup_no_match',
    message: `No external match for ${code}`,
    context: { code },
  });
  return null;
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
  const lonRange = maxDistance / (111 * Math.cos((lat * Math.PI) / 180));

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
  try {
    const zones = findTimezone(lat, lon);
    return zones.length > 0 ? zones[0] : null;
  } catch {
    return null;
  }
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
      operation: 'airport_timezone_backfill',
      message: 'All airports already have timezone data',
    });
    return 0;
  }

  logger.info({
    operation: 'airport_timezone_backfill',
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
        operation: 'airport_timezone_backfill',
        message: `Could not derive timezone for airport ${airport.iata || airport.icao}`,
        context: { lat: airport.lat, lon: airport.lon },
      });
    }
  }

  logger.info({
    operation: 'airport_timezone_backfill',
    message: `Backfill complete: ${updated}/${airports.length} airports updated`,
  });

  return updated;
}

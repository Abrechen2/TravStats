import { prisma } from '../db';

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
export async function findOrCreateAirport(code: string): Promise<any> {
  const upperCode = code.toUpperCase();

  // 1. Zuerst in lokaler DB suchen
  const existingAirport = await prisma.airport.findFirst({
    where: {
      OR: [
        { iata: upperCode },
        { icao: upperCode },
      ],
    },
  });

  if (existingAirport) {
    return existingAirport;
  }

  console.log(`Airport ${code} not found locally, searching external sources...`);

  // 2. Von externer API laden
  const externalData = await fetchFromExternalAPI(upperCode);

  if (!externalData) {
    return null;
  }

  // 3. In DB speichern
  console.log(`Storing new airport: ${externalData.name} (${code})`);

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
    },
  });

  return newAirport;
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
      const data: any = await response.json();

      if (data && data.latitude && data.longitude) {
        return {
          iata: data.iata || code,
          icao: data.icao,
          name: data.name,
          city: data.location,
          country: data.country,
          lat: parseFloat(data.latitude),
          lon: parseFloat(data.longitude),
          altitude: data.elevation_ft ? Math.round(parseFloat(data.elevation_ft) * 0.3048) : undefined,
        };
      }
    }
  } catch (error) {
    console.log(`Airport-data.com API failed for ${code}`);
  }

  // Fallback: Versuche OurAirports direkten Lookup mit Cache
  try {
    let csvText: string;
    const now = Date.now();

    // Check if cache is valid
    if (csvCache.data && (now - csvCache.timestamp) < CSV_CACHE_TTL) {
      console.log(`Using cached OurAirports data (age: ${Math.round((now - csvCache.timestamp) / 1000 / 60)}min)`);
      csvText = csvCache.data;
    } else {
      console.log('Downloading OurAirports CSV data (this may take a moment)...');
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
      console.log(`CSV data cached (${(csvText.length / 1024 / 1024).toFixed(2)}MB)`);
    }

    const lines = csvText.split('\n');
    console.log(`Searching ${lines.length} airports for code: ${code}`);

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
        console.log(`Found airport in CSV (line ${foundLine}):`);
        console.log(`   IATA: ${iataCode}, ICAO: ${icaoCode}`);
        console.log(`   Name: ${parts[3]}`);
        console.log(`   City: ${parts[10]}, Country: ${parts[8]}`);
        console.log(`   Coordinates: ${parts[4]}, ${parts[5]}`);

        const lat = parseFloat(parts[4]);
        const lon = parseFloat(parts[5]);

        if (isNaN(lat) || isNaN(lon)) {
          console.log(`Invalid coordinates for ${code}, skipping`);
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
      console.log(`Code ${code} not found in CSV (checked ${lines.length} lines)`);
    }
  } catch (error) {
    console.log(`OurAirports CSV lookup failed for ${code}:`, error);
  }

  console.log(`No external match for ${code}`);
  return null;
}

/**
 * Find nearest airport by coordinates
 * Returns the closest airport within maxDistance km
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
      lat: flightData.departure.lat ?? foundDeparture.lat,
      lon: flightData.departure.lon ?? foundDeparture.lon,
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
      lat: flightData.arrival.lat ?? foundArrival.lat,
      lon: flightData.arrival.lon ?? foundArrival.lon,
      altitude: flightData.arrival.altitude ?? foundArrival.altitude,
      timezone: flightData.arrival.timezone || foundArrival.timezone,
    };
  }

  return {
    departure: enrichedDeparture as AirportData,
    arrival: enrichedArrival as AirportData,
  };
}

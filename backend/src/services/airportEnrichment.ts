/**
 * Airport Data Enrichment Service
 *
 * Automatically enriches flight data with missing airport information
 * Uses local Airport database populated from OpenFlights.org
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AirportData {
  iata?: string | null;
  icao?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  altitude?: number | null;
  timezone?: string | null;
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
 * Find airport by IATA code
 */
export async function findAirportByIATA(iata: string): Promise<AirportData | null> {
  if (!iata || iata === '\\N') return null;

  const airport = await prisma.airport.findUnique({
    where: { iata: iata.toUpperCase() },
  });

  return airport;
}

/**
 * Find airport by ICAO code
 */
export async function findAirportByICAO(icao: string): Promise<AirportData | null> {
  if (!icao || icao === '\\N') return null;

  const airport = await prisma.airport.findUnique({
    where: { icao: icao.toUpperCase() },
  });

  return airport;
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
      closest = airport;
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
    const airport = await findAirportByIATA(airportData.iata);
    if (airport) return airport;
  }

  // Strategy 2: Lookup by ICAO code
  if (airportData.icao) {
    const airport = await findAirportByICAO(airportData.icao);
    if (airport) return airport;
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

/**
 * Search airports by query (name, city, IATA, or ICAO)
 * Useful for autocomplete/search features
 */
export async function searchAirports(
  query: string,
  limit: number = 10
): Promise<AirportData[]> {
  const searchTerm = query.toUpperCase();

  const airports = await prisma.airport.findMany({
    where: {
      OR: [
        { iata: { contains: searchTerm } },
        { icao: { contains: searchTerm } },
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
      ],
    },
    take: limit,
    orderBy: [
      { iata: 'asc' }, // Prefer airports with IATA codes
    ],
  });

  return airports;
}

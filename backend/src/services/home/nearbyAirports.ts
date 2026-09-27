import { prisma } from "../../db";
import { calculateDistance } from "../../utils/geo";
import { airportDisplayName } from "../../utils/airportDisplay";

/**
 * The airports near a residence, nearest first — what the settings page
 * OFFERS as home airports. An offer, not the list: any airport can still be
 * added through the ordinary airport search, so a field this misses (or a
 * residence 200 km from anything) never locks the user out of their airport.
 */

/** Far enough to reach the second airport of a metro region (Köln → DUS is 54 km). */
export const NEARBY_RADIUS_KM = 150;
export const NEARBY_LIMIT = 6;
const KM_PER_DEGREE = 111;

export interface NearbyAirport {
  code: string;
  name: string;
  city: string | null;
  distanceKm: number;
}

export async function findNearbyHomeAirports(lat: number, lon: number): Promise<NearbyAirport[]> {
  const latRange = NEARBY_RADIUS_KM / KM_PER_DEGREE;
  const lonRange =
    NEARBY_RADIUS_KM / (KM_PER_DEGREE * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  // Closed fields and rows without an IATA code are never offered: a home
  // airport is one you can book a flight from.
  const rows = await prisma.airport.findMany({
    where: {
      isClosed: false,
      iata: { not: null },
      lat: { gte: lat - latRange, lte: lat + latRange },
      lon: { gte: lon - lonRange, lte: lon + lonRange },
    },
    select: { iata: true, name: true, municipalityName: true, city: true, lat: true, lon: true },
  });
  return rows
    .filter(
      (r): r is typeof r & { iata: string } => typeof r.iata === "string" && r.iata.length === 3
    )
    .map((r) => ({
      code: r.iata,
      name: r.name,
      city: airportDisplayName(r),
      distanceKm: Math.round(calculateDistance(lat, lon, r.lat, r.lon)),
    }))
    .filter((a) => a.distanceKm <= NEARBY_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.code.localeCompare(b.code))
    .slice(0, NEARBY_LIMIT);
}

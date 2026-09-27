import { prisma } from "../../db";
import { calculateDistance } from "../../utils/geo";
import { airportDisplayName } from "../../utils/airportDisplay";
import { UNSCHEDULED_AIRPORT_CODES } from "../../data/unscheduledAirportCodes";

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

/**
 * The codes among `codes` this user has flown from or to (anything but a
 * cancelled flight). Such an airport stays on offer even without scheduled
 * service: the user's own logbook outranks the catalogue's opinion.
 */
async function flownCodes(userId: string, codes: readonly string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      OR: [{ depIata: { in: [...codes] } }, { arrIata: { in: [...codes] } }],
    },
    select: { depIata: true, arrIata: true },
  });
  const wanted = new Set(codes);
  return new Set(
    rows.flatMap((r) => [r.depIata, r.arrIata]).filter((c): c is string => !!c && wanted.has(c))
  );
}

export async function findNearbyHomeAirports(
  userId: string,
  lat: number,
  lon: number
): Promise<NearbyAirport[]> {
  const latRange = NEARBY_RADIUS_KM / KM_PER_DEGREE;
  const lonRange =
    NEARBY_RADIUS_KM / (KM_PER_DEGREE * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  // Closed fields and rows without an IATA code are never offered: a home
  // airport is one you can book a flight from. Fields without scheduled
  // service are filtered below, unless this user has flown from them.
  const rows = await prisma.airport.findMany({
    where: {
      isClosed: false,
      iata: { not: null },
      lat: { gte: lat - latRange, lte: lat + latRange },
      lon: { gte: lon - lonRange, lte: lon + lonRange },
    },
    select: { iata: true, name: true, municipalityName: true, city: true, lat: true, lon: true },
  });
  const withCode = rows.filter(
    (r): r is typeof r & { iata: string } => typeof r.iata === "string" && r.iata.length === 3
  );
  // An IATA code alone does not make an airport one you fly from: air bases
  // and business fields carry codes too (GKE Geilenkirchen, MGL
  // Mönchengladbach sat above Dortmund in the offer for Köln). The catalogue
  // has no service column, so the signal is a vendored list derived from the
  // same OurAirports CSV (`scripts/build-unscheduled-airports.mjs`).
  const flown = await flownCodes(
    userId,
    withCode.map((r) => r.iata).filter((c) => UNSCHEDULED_AIRPORT_CODES.has(c))
  );
  return withCode
    .filter((r) => !UNSCHEDULED_AIRPORT_CODES.has(r.iata) || flown.has(r.iata))
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

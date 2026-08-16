/**
 * Matching an incoming lodging against one already stored, by where it IS.
 *
 * The import matcher goes `externalRef` -> name+city -> name, and never looks
 * at coordinates. So a house whose name differs by a decoration survives twice:
 *
 *   "Hotel Fortuna"               from a booking mail, carrying the stay
 *   "Hotel - Restaurant Fortuna"  from the saved-places export
 *
 * Measured on the owner's library: 25 such pairs among 293 houses, and 24 of
 * them sit on the same coordinate. A name can be decorated; a building cannot
 * move.
 */

export interface PinnedLodging {
  id: string;
  lat: number | null;
  lon: number | null;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a flat approximation: the cheap version treats a degree
 * of longitude as a fixed width, which is 111 km at the equator and 73 km at
 * 49° N — the latitude most of this catalogue sits at.
 */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Stored lodgings within `radiusMetres` of the incoming pin, nearest first.
 *
 * A stored row without a pin is skipped rather than read as 0/0 — that point is
 * in the Atlantic, and treating it as a coordinate would match every unpinned
 * house against every other.
 *
 * The caller decides what a hit means. In the import preview a proximity hit is
 * a GUESS, surfaced for confirmation like a name+city hit, never a silent skip:
 * two hotels can genuinely share an address (a chain's two brands in one
 * building), and quietly folding them together loses a house.
 */
export function findNearbyLodgings(
  stored: ReadonlyArray<PinnedLodging>,
  lat: number | null | undefined,
  lon: number | null | undefined,
  radiusMetres: number,
): PinnedLodging[] {
  if (typeof lat !== "number" || typeof lon !== "number") return [];

  return stored
    .filter(
      (candidate): candidate is PinnedLodging & { lat: number; lon: number } =>
        typeof candidate.lat === "number" && typeof candidate.lon === "number",
    )
    .map((candidate) => ({
      candidate,
      distance: metresBetween(lat, lon, candidate.lat, candidate.lon),
    }))
    .filter(({ distance }) => distance <= radiusMetres)
    .sort((a, b) => a.distance - b.distance)
    .map(({ candidate }) => candidate);
}

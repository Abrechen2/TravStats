/**
 * Where the nights happened. Pure — no I/O, no Prisma.
 *
 * The lodging rows have carried `lat`/`lon` since the geocoding backfill and
 * no statistic ever read them: the map drew pins, and that was the whole use.
 */
import { continentForCoordinates, continentForCountry } from "../continents";
import type { StayWithNights } from "./money";
import type { LodgingGeoStats, LodgingPlace, LodgingPlaceCount } from "./types";

/** Coordinates are stored to far more precision than a centroid can honestly claim. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

const DEG = Math.PI / 180;

/**
 * Nights-weighted mean position, computed on the UNIT SPHERE rather than by
 * averaging the two numbers.
 *
 * Averaging longitudes puts the mean of 179°E and 179°W on the prime meridian
 * — in Africa, for someone who only ever slept either side of the dateline.
 * Projecting to 3D, averaging the vectors and projecting back has no such seam.
 * A traveller whose nights genuinely cancel out (antipodal pairs) yields a zero
 * vector; that returns null rather than an arbitrary point.
 */
function centreOfGravity(
  points: Array<{ lat: number; lon: number; weight: number }>,
): { lat: number; lon: number } | null {
  if (points.length === 0) return null;

  let x = 0;
  let y = 0;
  let z = 0;
  let totalWeight = 0;
  for (const p of points) {
    const latRad = p.lat * DEG;
    const lonRad = p.lon * DEG;
    const cosLat = Math.cos(latRad);
    x += Math.cos(lonRad) * cosLat * p.weight;
    y += Math.sin(lonRad) * cosLat * p.weight;
    z += Math.sin(latRad) * p.weight;
    totalWeight += p.weight;
  }
  if (totalWeight === 0) return null;

  x /= totalWeight;
  y /= totalWeight;
  z /= totalWeight;

  const hyp = Math.sqrt(x * x + y * y);
  // Degenerate: the weighted vectors cancelled. There is no honest centre.
  if (hyp < 1e-12 && Math.abs(z) < 1e-12) return null;

  return {
    lat: round4(Math.atan2(z, hyp) / DEG),
    lon: round4(Math.atan2(y, x) / DEG),
  };
}

function toPlace(entry: StayWithNights, lat: number, lon: number): LodgingPlace {
  return {
    lodgingId: entry.stay.lodgingId,
    lodgingName: entry.stay.lodgingName,
    city: entry.stay.city,
    country: entry.stay.country,
    lat,
    lon,
    checkIn: entry.stay.checkIn.toISOString(),
  };
}

function toCounts(map: Map<string, { nights: number; stays: number }>): LodgingPlaceCount[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, nights: v.nights, stays: v.stays }))
    .sort((a, b) => b.nights - a.nights || b.stays - a.stays || a.key.localeCompare(b.key));
}

export function computeGeoStats(entries: StayWithNights[]): LodgingGeoStats {
  const continents = new Set<string>();
  const cityCounts = new Map<string, { nights: number; stays: number }>();
  const countryCounts = new Map<string, { nights: number; stays: number }>();
  const points: Array<{ lat: number; lon: number; weight: number }> = [];

  let northernmost: LodgingPlace | null = null;
  let southernmost: LodgingPlace | null = null;
  let unlocatedStays = 0;

  for (const entry of entries) {
    const { stay, nights } = entry;

    if (stay.city) {
      const cur = cityCounts.get(stay.city) ?? { nights: 0, stays: 0 };
      cityCounts.set(stay.city, { nights: cur.nights + nights, stays: cur.stays + 1 });
    }
    if (stay.country) {
      const cur = countryCounts.get(stay.country) ?? { nights: 0, stays: 0 };
      countryCounts.set(stay.country, { nights: cur.nights + nights, stays: cur.stays + 1 });
    }

    const hasCoords = stay.lat !== null && stay.lon !== null;

    // Country first, coordinates as the fallback — the country answer is exact
    // and the coordinate boxes exist only so a missing country never silently
    // drops a continent (see utils/continents.ts).
    const continent =
      continentForCountry(stay.country, stay.lat ?? undefined, stay.lon ?? undefined) ??
      (hasCoords ? continentForCoordinates(stay.lat!, stay.lon!) : null);
    if (continent) continents.add(continent);

    if (!hasCoords) {
      unlocatedStays += 1;
      continue;
    }

    const lat = stay.lat!;
    const lon = stay.lon!;
    // Weighted by nights: a fortnight in Tromsø should pull the centre harder
    // than one night at an airport hotel.
    points.push({ lat, lon, weight: Math.max(nights, 1) });

    if (northernmost === null || lat > northernmost.lat) {
      northernmost = toPlace(entry, lat, lon);
    }
    if (southernmost === null || lat < southernmost.lat) {
      southernmost = toPlace(entry, lat, lon);
    }
  }

  return {
    continents: [...continents].sort(),
    continentsCount: continents.size,
    northernmost,
    southernmost,
    centreOfGravity: centreOfGravity(points),
    topCities: toCounts(cityCounts),
    topCountries: toCounts(countryCounts),
    unlocatedStays,
  };
}

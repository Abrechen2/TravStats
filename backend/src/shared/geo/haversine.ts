/**
 * Great-circle distance helpers used by sea-routing and any future
 * distance-based features (port clustering, ferry routing).
 *
 * Kept framework-free so the same file can be re-used in scripts
 * (`scripts/generate-land-mask.ts`) without pulling any server deps.
 */

/** Earth mean radius in kilometres (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

const RAD_PER_DEG = Math.PI / 180;

/**
 * Haversine great-circle distance between two lon/lat points.
 *
 * Returns kilometres. Not meant for antipodal-pair precision (use
 * Vincenty for that) but accurate to < 0.5 % at any cruise distance.
 */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = (b.lat - a.lat) * RAD_PER_DEG;
  const dLon = (b.lon - a.lon) * RAD_PER_DEG;
  const lat1 = a.lat * RAD_PER_DEG;
  const lat2 = b.lat * RAD_PER_DEG;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_KM * c;
}

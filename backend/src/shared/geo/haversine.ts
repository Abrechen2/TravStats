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

const DEG_PER_RAD = 180 / Math.PI;

/**
 * Spherical linear interpolation along the great circle from `a` to `b`
 * at fractional progress `t` in `[0, 1]`. Returns lat/lon in degrees.
 *
 * Adjusts for the antimeridian so near-antipodal pairs don't jump into
 * the wrong hemisphere. For `t ≈ 0.5` and antipodal endpoints the
 * great circle is ambiguous; we pick the shorter path via the atan2
 * reconstruction, which the Hybrid v2 callers never exercise because
 * they never sample between antipodes.
 */
export function slerp(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  const lat1 = a.lat * RAD_PER_DEG;
  const lon1 = a.lon * RAD_PER_DEG;
  const lat2 = b.lat * RAD_PER_DEG;
  let lon2 = b.lon * RAD_PER_DEG;
  if (lon2 - lon1 > Math.PI) lon2 -= 2 * Math.PI;
  if (lon2 - lon1 < -Math.PI) lon2 += 2 * Math.PI;

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };

  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);
  return { lat: lat * DEG_PER_RAD, lon: lon * DEG_PER_RAD };
}

/** Sum of haversine segments along a polyline given as `{lat, lon}` points. */
export function polylineLengthKm(coords: ReadonlyArray<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineKm(coords[i - 1], coords[i]);
  }
  return total;
}

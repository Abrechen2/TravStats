import type { LonLat } from "./types";

const R_EARTH_KM = 6371.0088;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/** Great-circle distance in km between two `[lon, lat]` points. */
export function haversineKm(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * TO_RAD;
  const lat2 = b[1] * TO_RAD;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * TO_RAD;
  const s = Math.sin(dLat / 2);
  const c = Math.sin(dLon / 2);
  const h = s * s + Math.cos(lat1) * Math.cos(lat2) * c * c;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sum of haversine segments along a polyline. */
export function polylineLengthKm(coords: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineKm(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Spherical linear interpolation (slerp) along the great circle from
 * `a` to `b` at fractional progress `t` in [0,1]. Adjusts for the
 * antimeridian so near-antipodal pairs don't take the wrong hemisphere.
 */
export function slerp(a: LonLat, b: LonLat, t: number): LonLat {
  const lat1 = a[1] * TO_RAD;
  const lon1 = a[0] * TO_RAD;
  const lat2 = b[1] * TO_RAD;
  let lon2 = b[0] * TO_RAD;
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
  if (d < 1e-9) return [a[0], a[1]];

  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);
  return [lon * TO_DEG, lat * TO_DEG];
}

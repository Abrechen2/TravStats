/**
 * Compute [west, south, east, north] bounding box for a set of [lon, lat] points.
 * Returns null if points array is empty.
 */
export function computeBbox(
  points: Array<[number, number]>
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Interpolate a position along the great-circle arc at progress t (0→1).
 * Uses spherical linear interpolation (slerp) so the icon follows the arc
 * layer on long-haul routes rather than cutting across in lat/lon space.
 * Falls back to linear interpolation for near-identical endpoints.
 */
export function arcPosition(
  source: [number, number],
  target: [number, number],
  t: number
): [number, number] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const lat1 = source[1] * toRad;
  const lon1 = source[0] * toRad;
  const lat2 = target[1] * toRad;
  const lon2 = target[0] * toRad;

  // Angular distance between the two points on the unit sphere
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );

  // For very short distances fall back to cheap linear interpolation
  if (d < 1e-10) {
    return [source[0] + (target[0] - source[0]) * t, source[1] + (target[1] - source[1]) * t];
  }

  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);

  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);

  return [lon * toDeg, lat * toDeg];
}

/** Ease-in-out cubic for smooth animation */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

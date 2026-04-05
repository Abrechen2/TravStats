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

/** Linearly interpolate a position along the arc at progress t (0→1). */
export function arcPosition(
  source: [number, number],
  target: [number, number],
  t: number
): [number, number] {
  return [source[0] + (target[0] - source[0]) * t, source[1] + (target[1] - source[1]) * t];
}

/** Ease-in-out cubic for smooth animation */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

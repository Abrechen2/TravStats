type LonLat = [number, number];

/**
 * Build a quadratic Bezier arc path between two geographic points.
 *
 * The control point is offset perpendicular to the straight segment, so
 * cruise legs render as a curved line rather than a straight chord. The
 * offset magnitude scales with the segment length (20%) to keep short
 * hops subtly curved and long hops more pronounced.
 *
 * Returns `resolution + 1` points — path includes both endpoints.
 */
export function buildCruiseArc(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  resolution = 64
): LonLat[] {
  const dx = to.lon - from.lon;
  const dy = to.lat - from.lat;
  const midLon = (from.lon + to.lon) / 2;
  const midLat = (from.lat + to.lat) / 2;
  const length = Math.sqrt(dx * dx + dy * dy);
  const offsetMagnitude = length * 0.2;
  const perp: LonLat = [-dy, dx];
  const perpLen = Math.sqrt(perp[0] ** 2 + perp[1] ** 2) || 1;
  const ctrl: LonLat = [
    midLon + (perp[0] / perpLen) * offsetMagnitude,
    midLat + (perp[1] / perpLen) * offsetMagnitude,
  ];

  const path: LonLat[] = [];
  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution;
    const it = 1 - t;
    const lon = it * it * from.lon + 2 * it * t * ctrl[0] + t * t * to.lon;
    const lat = it * it * from.lat + 2 * it * t * ctrl[1] + t * t * to.lat;
    path.push([lon, lat]);
  }
  return path;
}

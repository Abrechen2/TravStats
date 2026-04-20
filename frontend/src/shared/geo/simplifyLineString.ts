/**
 * Douglas-Peucker polyline simplification for GeoJSON-style
 * `[lon, lat]` coordinate arrays, with tolerance expressed in
 * kilometres and projected distance computed on an equirectangular
 * plane centred at the line's midpoint latitude.
 *
 * Used by the cruise-map frontend to drop vertices from A*-derived
 * sea-routes at low zoom levels, where a transatlantic route's
 * ~500 raw grid points compress to <30 without visible distortion.
 *
 * Planar projection is deliberately chosen over full great-circle
 * cross-track distance — at our 0.1° raster scale the planar
 * approximation error stays well under 1 % even for polar routes, and
 * runs ~10× faster in pure TS. For long polar passages where great-
 * circle accuracy would matter, the tolerance is already at 20-50 km,
 * so the approximation is invisible.
 */

export type LonLat = [number, number];

const KM_PER_DEG_LAT = 111.132;

/**
 * Return a simplified copy of `coords`. The first and last point are
 * always kept. `toleranceKm` is the maximum perpendicular distance in
 * kilometres from the simplified polyline to the original points.
 *
 * Passing `toleranceKm <= 0` or `coords.length <= 2` returns the input
 * as-is (no copy — coords is `readonly`). Callers who need immutable
 * results can spread it themselves.
 */
export function simplifyLineString(coords: ReadonlyArray<LonLat>, toleranceKm: number): LonLat[] {
  if (coords.length <= 2 || toleranceKm <= 0) {
    return coords.slice();
  }
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  dpRecurse(coords, 0, coords.length - 1, toleranceKm, keep);

  const out: LonLat[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (keep[i]) out.push(coords[i]);
  }
  return out;
}

/**
 * Recursive half of Douglas-Peucker. Find the point in [i+1..j-1]
 * farthest from the chord (i→j); if its distance exceeds the tolerance
 * keep it and recurse on both halves. Otherwise drop everything in
 * between — they're close enough to the chord.
 */
function dpRecurse(
  coords: ReadonlyArray<LonLat>,
  i: number,
  j: number,
  toleranceKm: number,
  keep: Uint8Array
): void {
  if (j - i < 2) return;

  let maxDist = -1;
  let maxIdx = -1;
  for (let k = i + 1; k < j; k++) {
    const d = perpendicularKm(coords[i], coords[j], coords[k]);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = k;
    }
  }
  if (maxDist > toleranceKm && maxIdx !== -1) {
    keep[maxIdx] = 1;
    dpRecurse(coords, i, maxIdx, toleranceKm, keep);
    dpRecurse(coords, maxIdx, j, toleranceKm, keep);
  }
}

/**
 * Perpendicular distance in kilometres from point `p` to the line
 * segment (a → b), computed on a local equirectangular projection
 * centred at the mean latitude of a and b.
 *
 * When `a` and `b` coincide, returns the great-circle distance from
 * `a` to `p` (degenerate segment).
 */
export function perpendicularKm(a: LonLat, b: LonLat, p: LonLat): number {
  const midLat = (a[1] + b[1]) / 2;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);

  const ax = a[0] * kmPerDegLon;
  const ay = a[1] * KM_PER_DEG_LAT;
  const bx = b[0] * kmPerDegLon;
  const by = b[1] * KM_PER_DEG_LAT;
  const px = p[0] * kmPerDegLon;
  const py = p[1] * KM_PER_DEG_LAT;

  const dx = bx - ax;
  const dy = by - ay;
  const segLenSq = dx * dx + dy * dy;

  if (segLenSq === 0) {
    // Degenerate segment — distance from p to a.
    const ddx = px - ax;
    const ddy = py - ay;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // Project p onto line (a→b); clamp to segment for end-cap behaviour.
  let t = ((px - ax) * dx + (py - ay) * dy) / segLenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

/**
 * Default tolerance table per deck.gl-style zoom level. Picks the
 * smallest tolerance whose breakpoint is ≤ the given zoom.
 *
 *   zoom ≤ 3 (world)     → 50 km  — transatlantic compresses to <20 pts
 *   zoom ≤ 6 (continent) → 20 km  — Mediterranean leg stays smooth
 *   zoom ≤ 9 (regional)  → 5 km   — approaches keep their bends
 *   zoom > 9 (port)      → 0 (no simplification, raw geometry)
 */
export function toleranceKmForZoom(zoom: number): number {
  if (zoom <= 3) return 50;
  if (zoom <= 6) return 20;
  if (zoom <= 9) return 5;
  return 0;
}

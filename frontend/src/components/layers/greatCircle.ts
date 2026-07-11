// Great-circle interpolation for flat (surface) flight routes (#183).
//
// A flat route between two airports must NOT be a straight chord in lon/lat
// space: on Web Mercator that is a rhumb-ish line that runs well south of the
// track an aircraft actually flies (FRA-JFK would cut across the mid-Atlantic
// instead of curving up past Newfoundland). The chord also looks visibly
// "wrong" next to the 3D arc it replaces, which deck.gl's ArcLayer draws as a
// bow over the same endpoints.
//
// Cruises solve the same "path along the surface" problem by asking the backend
// for real sea-route waypoints and splining through them. A flight has no such
// per-leg geometry — the shortest path over water OR land is simply the great
// circle — so we densify it here, client-side, and hand deck.gl a PathLayer
// path.
//
// Longitudes are kept CONTINUOUS (they may leave [-180, 180]) rather than being
// wrapped: a path whose vertices jump from 179° to -179° is drawn by deck.gl as
// a segment straight back across the entire map. deck.gl projects out-of-range
// longitudes into the adjacent world copy, which is what we want.

type LonLat = [number, number];

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Angular distance (radians) between two lon/lat points on the unit sphere. */
export function angularDistance(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Point at fraction `t` (0 = a, 1 = b) along the great circle through a and b,
 * via spherical linear interpolation.
 *
 * Degenerate inputs are handled rather than producing NaN:
 *   - coincident points (d ≈ 0) → `a`
 *   - antipodal points (d ≈ π) → no unique great circle exists at all, so we
 *     fall back to a linear lon/lat blend. Antipodal airport pairs don't occur
 *     in practice; this only guards the maths.
 */
export function interpolateGreatCircle(a: LonLat, b: LonLat, t: number, d?: number): LonLat {
  const dist = d ?? angularDistance(a, b);
  const sinD = Math.sin(dist);
  if (dist < 1e-9 || Math.abs(sinD) < 1e-9) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const lat1 = a[1] * DEG;
  const lon1 = a[0] * DEG;
  const lat2 = b[1] * DEG;
  const lon2 = b[0] * DEG;
  const A = Math.sin((1 - t) * dist) / sinD;
  const B = Math.sin(t * dist) / sinD;
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [Math.atan2(y, x) * RAD, Math.atan2(z, Math.hypot(x, y)) * RAD];
}

/** Shift `lon` by ±360° so it lands within 180° of `anchor` — keeps a path's
 *  longitudes continuous across the antimeridian instead of snapping back. */
function unwrapLon(anchor: number, lon: number): number {
  let out = lon;
  while (out - anchor > 180) out -= 360;
  while (out - anchor < -180) out += 360;
  return out;
}

// One vertex roughly every 2° of arc keeps a transatlantic route smooth without
// bloating the layer. Clamped so a 300 km hop still gets a real polyline and a
// half-circumference route doesn't explode. Rounded UP to a multiple of
// SEGMENT_GRANULARITY so the tip/core cuts in `flatRoutesLayer` land exactly on
// sample boundaries (shared vertices → no seam between sub-paths).
const DEGREES_PER_SEGMENT = 2;
const MIN_SEGMENTS = 10;
const MAX_SEGMENTS = 120;
const SEGMENT_GRANULARITY = 10;

function segmentCount(distanceRad: number): number {
  const raw = Math.ceil((distanceRad * RAD) / DEGREES_PER_SEGMENT);
  const clamped = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, raw));
  const remainder = clamped % SEGMENT_GRANULARITY;
  return remainder === 0 ? clamped : clamped + (SEGMENT_GRANULARITY - remainder);
}

export interface GreatCirclePath {
  /** Densified vertices, first === `a` and last === `b` exactly. Longitudes are
   *  continuous and may exceed ±180 for antimeridian-crossing routes. */
  points: LonLat[];
  /** Number of SEGMENTS (points.length - 1). Always a multiple of 10, so a cut
   *  at any tenth of the route falls on an existing vertex. */
  segments: number;
}

/**
 * Densify the great circle from `a` to `b`. The endpoints are passed through
 * verbatim (not re-derived from the slerp) so an airport marker and its route
 * always meet exactly.
 */
export function greatCirclePath(a: LonLat, b: LonLat): GreatCirclePath {
  const d = angularDistance(a, b);
  const segments = segmentCount(d);
  const points: LonLat[] = [a];
  let prevLon = a[0];
  for (let i = 1; i < segments; i++) {
    const [lon, lat] = interpolateGreatCircle(a, b, i / segments, d);
    const continuous = unwrapLon(prevLon, lon);
    prevLon = continuous;
    points.push([continuous, lat]);
  }
  points.push([unwrapLon(prevLon, b[0]), b[1]]);
  return { points, segments };
}

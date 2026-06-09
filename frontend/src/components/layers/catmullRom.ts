type LonLat = [number, number];

/**
 * Densify a waypoint polyline with a centripetal Catmull-Rom spline
 * (α = 0.5) so the rendered path looks smooth instead of piecewise-
 * linear.
 *
 * Uniform parametrisation (α = 0, the classic textbook variant)
 * worked when the backend's control polygon was sparse and well-
 * spaced, but the marnet shipping graph occasionally produces near-
 * coincident vertices inside straits (Florida Strait, Bosphorus,
 * Fehmarnbelt) where the cluster of duplicate nodes drives the
 * uniform-CR formula past its overshoot regime: the spline curves
 * back through the polygon, drawing a visible u-turn loop. The
 * centripetal variant redistributes parameter spacing by the square
 * root of the chord length, eliminating the overshoot at sharp
 * corners while staying interpolating (each control point is exactly
 * on the curve).
 *
 * Endpoints are phantom-reflected so the curve visibly passes
 * through the first and last waypoints.
 *
 * `samplesPerSegment` controls smoothness; 12 is plenty visually
 * without bloating the layer.
 */
export function catmullRomSpline(
  waypoints: ReadonlyArray<LonLat>,
  samplesPerSegment = 12
): LonLat[] {
  if (waypoints.length < 2) return waypoints.slice() as LonLat[];
  if (waypoints.length === 2) return waypoints.slice() as LonLat[];

  const pts = waypoints;
  const out: LonLat[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    // Antimeridian normalisation: a route from lon 179° to lon -179° is
    // 2° apart on the globe, but the raw difference reads as -358° and
    // a planar Catmull-Rom would interpolate "the long way around"
    // (almost all the way across the planet). Snap each neighbouring
    // control point's longitude into the half-plane within 180° of p1
    // before feeding the spline. Output longitudes are wrapped back into
    // [-180, 180] so consumers (deck.gl, MapLibre) draw the segment
    // straight across the antimeridian instead of looping the globe.
    const p0raw = i === 0 ? reflect(pts[0], pts[1]) : pts[i - 1];
    const p2raw = pts[i + 1];
    const p3raw = i + 2 < pts.length ? pts[i + 2] : reflect(pts[i + 1], pts[i]);
    const p0 = unwrapLonAround(p1[0], p0raw);
    const p2 = unwrapLonAround(p1[0], p2raw);
    const p3 = unwrapLonAround(p1[0], p3raw);

    // Centripetal parameterisation: t_{n+1} = t_n + |p_{n+1} - p_n|^α with α = 0.5.
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.max(1e-6, distance(p0, p1)));
    const t2 = t1 + Math.sqrt(Math.max(1e-6, distance(p1, p2)));
    const t3 = t2 + Math.sqrt(Math.max(1e-6, distance(p2, p3)));

    for (let s = 0; s < samplesPerSegment; s++) {
      const t = t1 + (t2 - t1) * (s / samplesPerSegment);
      const sample = catmullPoint(p0, p1, p2, p3, t0, t1, t2, t3, t);
      out.push([wrapLon(sample[0]), sample[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Shift `point.lon` by ±360° so it lies within ±180° of `anchorLon`.
 * Latitude is unchanged. Used to keep a Catmull-Rom window in a
 * continuous longitude space when crossing the antimeridian. */
function unwrapLonAround(anchorLon: number, point: LonLat): LonLat {
  let lon = point[0];
  while (lon - anchorLon > 180) lon -= 360;
  while (lon - anchorLon < -180) lon += 360;
  return [lon, point[1]];
}

/** Wrap a longitude back into [-180, 180]. Exact-passthrough for inputs
 * already in range so antimeridian-handling code doesn't introduce
 * floating-point noise on every-day longitudes. */
function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function distance(a: LonLat, b: LonLat): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function reflect(anchor: LonLat, toward: LonLat): LonLat {
  return [2 * anchor[0] - toward[0], 2 * anchor[1] - toward[1]];
}

function catmullPoint(
  p0: LonLat,
  p1: LonLat,
  p2: LonLat,
  p3: LonLat,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number
): LonLat {
  const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / Math.max(1e-9, t1 - t0);
  const a1y = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / Math.max(1e-9, t1 - t0);
  const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / Math.max(1e-9, t2 - t1);
  const a2y = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / Math.max(1e-9, t2 - t1);
  const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / Math.max(1e-9, t3 - t2);
  const a3y = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / Math.max(1e-9, t3 - t2);
  const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / Math.max(1e-9, t2 - t0);
  const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / Math.max(1e-9, t2 - t0);
  const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / Math.max(1e-9, t3 - t1);
  const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / Math.max(1e-9, t3 - t1);
  return [
    ((t2 - t) * b1x + (t - t1) * b2x) / Math.max(1e-9, t2 - t1),
    ((t2 - t) * b1y + (t - t1) * b2y) / Math.max(1e-9, t2 - t1),
  ];
}

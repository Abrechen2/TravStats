type LonLat = [number, number];

/**
 * Densify a waypoint polyline with a Catmull-Rom spline so the
 * rendered path looks smooth instead of piecewise-linear. Uniform
 * parametrisation (`alpha = 0`) is fine for our purposes — the
 * waypoints are already spaced at continental-detour scale, so loops
 * and cusps don't occur. Endpoints are phantom-reflected so the
 * curve visibly passes through the first and last waypoints.
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
    const p0 = i === 0 ? reflect(pts[0], pts[1]) : pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < pts.length ? pts[i + 2] : reflect(pts[i + 1], pts[i]);

    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      out.push(catmullPoint(p0, p1, p2, p3, t));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function reflect(anchor: LonLat, toward: LonLat): LonLat {
  return [2 * anchor[0] - toward[0], 2 * anchor[1] - toward[1]];
}

function catmullPoint(p0: LonLat, p1: LonLat, p2: LonLat, p3: LonLat, t: number): LonLat {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const y =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, y];
}

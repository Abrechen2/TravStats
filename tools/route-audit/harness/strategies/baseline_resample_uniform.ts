/**
 * Strategy: baseline → arc-resample 60 km → frontend's existing
 * uniform Catmull-Rom (α=0).
 *
 * Tests whether a backend-only change (resample) is sufficient — i.e.,
 * whether we can keep the frontend's existing uniform Catmull-Rom and
 * still match the centripetal-variant winner. If this strategy
 * matches `baseline_resample_centripetal` we ship a one-file backend
 * change. If it has visible overshoot or extra kinks, the frontend
 * spline must also switch to centripetal.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { resampleArcLength } from '../geom';
import type { Strategy, Waypoint } from '../types';

type LonLat = [number, number];

/** Verbatim copy of the frontend's catmullRomSpline (uniform α=0). */
function catmullRomUniform(
  waypoints: ReadonlyArray<Waypoint>,
  samplesPerSegment = 12,
): LonLat[] {
  if (waypoints.length < 2) return waypoints.slice() as LonLat[];
  if (waypoints.length === 2) return waypoints.slice() as LonLat[];

  const pts = waypoints;
  const out: LonLat[] = [];
  const reflect = (anchor: Waypoint, toward: Waypoint): LonLat =>
    [2 * anchor[0] - toward[0], 2 * anchor[1] - toward[1]];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i === 0 ? reflect(pts[0], pts[1]) : pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < pts.length ? pts[i + 2] : reflect(pts[i + 1], pts[i]);

    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
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
      out.push([x, y]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

export const baselineResampleUniform: Strategy = {
  name: 'baseline_resample_uniform',
  description: 'Baseline → arc-resample 60 km → uniform Catmull-Rom (frontend port).',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 60);
    const rendered = catmullRomUniform(resampled, 12);
    return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

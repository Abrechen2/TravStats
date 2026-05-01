/**
 * Strategy: production → arc-length resample 60 km → centripetal
 * Catmull-Rom. Combines noise-removal at the control level with
 * smooth-spline rendering. Most realistic preview of "what if the
 * frontend used centripetal AND we washed out the segment-length
 * noise".
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { catmullRomCentripetal, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

export const baselineResampleCentripetal: Strategy = {
  name: 'baseline_resample_centripetal',
  description: 'Baseline → arc-resample 60 km → centripetal Catmull-Rom.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 60);
    const rendered = catmullRomCentripetal(resampled, 16);
    return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

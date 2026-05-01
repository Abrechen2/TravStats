/**
 * Strategy: baseline → resample 60 km → Chaikin × 1 → centripetal.
 * Hypothesis: a single Chaikin pass softens any remaining sharp turns
 * BEFORE the centripetal sampler, giving an even smoother result.
 * Risk: Chaikin pulls corners inward, which on coastal turns can
 * push the curve onto land.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { catmullRomCentripetal, chaikin, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

export const baselineResampleChaikinCentripetal: Strategy = {
  name: 'baseline_resample_chaikin_centripetal',
  description: 'Baseline → resample 60 km → Chaikin × 1 → centripetal.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 60);
    const softened = chaikin(resampled, 1);
    const rendered = catmullRomCentripetal(softened, 16);
    return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

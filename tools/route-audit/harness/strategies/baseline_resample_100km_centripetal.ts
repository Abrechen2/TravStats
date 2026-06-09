/**
 * Variant: arc-resample at 100 km. Sparser controls = stronger smoothing
 * but risk losing routing detail (corridor through Sound, Bosporus
 * narrowing).
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { catmullRomCentripetal, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

export const baselineResample100kmCentripetal: Strategy = {
  name: 'baseline_resample_100km_centripetal',
  description: 'Baseline → arc-resample 100 km → centripetal.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 100);
    const rendered = catmullRomCentripetal(resampled, 16);
    return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

/**
 * Variant: arc-resample at 30 km instead of 60 km. Denser control
 * polygon = curve hugs the original path more closely. Tests whether
 * 60 km is over-smoothing, dropping detail we want to keep.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { catmullRomCentripetal, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

export const baselineResample30kmCentripetal: Strategy = {
  name: 'baseline_resample_30km_centripetal',
  description: 'Baseline → arc-resample 30 km → centripetal Catmull-Rom.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 30);
    const rendered = catmullRomCentripetal(resampled, 16);
    return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

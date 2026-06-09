/**
 * Strategy: production baseline + arc-length resample at 60 km.
 * Hypothesis B from BRIEF.md: the kinks are driven by 44-km/3-km
 * segment-length noise — resampling washes that out before any
 * smoothing.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { resampleArcLength } from '../geom';
import type { Strategy } from '../types';

export const baselineResample: Strategy = {
  name: 'baseline_resample',
  description: 'Production baseline → arc-length resample at 60 km.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 60);
    return { waypoints: resampled, meta: { method: result.method, originalCount: result.waypoints.length } };
  },
};

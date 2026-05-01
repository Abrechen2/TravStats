/**
 * Strategy: production → 60 km resample → Chaikin × 2. The combined
 * "wash out segment noise THEN smooth corners" stack from BRIEF.md
 * (B1 + A1).
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { chaikin, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

export const baselineResampleChaikin: Strategy = {
  name: 'baseline_resample_chaikin',
  description: 'Baseline → arc-resample 60 km → Chaikin × 2.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 60);
    const smoothed = chaikin(resampled, 2);
    return { waypoints: smoothed, meta: { method: result.method, originalCount: result.waypoints.length } };
  },
};

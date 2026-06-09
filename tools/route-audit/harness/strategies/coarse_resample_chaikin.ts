/**
 * Strategy: coarse 1° A* (marnet disabled) → arc-resample 50 km →
 * Chaikin × 2. Combines wash-out-noise with corner-cutting.
 */
import { computeSchematicRoute, clearSchematicRouteCache } from '../../../../backend/src/services/schematicRouter';
import { setMarnetGraphForTesting, buildMarnetGraphForTesting } from '../../../../backend/src/services/marnet/marnetGraph';
import { chaikin, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

const emptyGraph = buildMarnetGraphForTesting({ type: 'FeatureCollection', features: [] });

export const coarseResampleChaikin: Strategy = {
  name: 'coarse_resample_chaikin',
  description: 'Coarse 1° A* → arc-resample 50 km → Chaikin × 2.',
  async route(dep, arr) {
    setMarnetGraphForTesting(emptyGraph);
    clearSchematicRouteCache();
    try {
      const result = await computeSchematicRoute(dep, arr);
      const resampled = resampleArcLength(result.waypoints, 50);
      const smoothed = chaikin(resampled, 2);
      return { waypoints: smoothed, meta: { method: result.method, originalCount: result.waypoints.length } };
    } finally {
      setMarnetGraphForTesting(null);
      clearSchematicRouteCache();
    }
  },
};

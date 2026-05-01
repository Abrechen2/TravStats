/**
 * Strategy: marnet disabled, coarse 1° A* + Chaikin × 3.
 * Hypothesis: 1° A* gives a topologically correct path; cell-corner
 * dog-legs are exactly what Chaikin smooths out (per design).
 */
import { computeSchematicRoute, clearSchematicRouteCache } from '../../../../backend/src/services/schematicRouter';
import { setMarnetGraphForTesting, buildMarnetGraphForTesting } from '../../../../backend/src/services/marnet/marnetGraph';
import { chaikin } from '../geom';
import type { Strategy } from '../types';

const emptyGraph = buildMarnetGraphForTesting({ type: 'FeatureCollection', features: [] });

export const coarseChaikin: Strategy = {
  name: 'coarse_chaikin',
  description: 'Coarse 1° A* (no marnet) → Chaikin × 3.',
  async route(dep, arr) {
    setMarnetGraphForTesting(emptyGraph);
    clearSchematicRouteCache();
    try {
      const result = await computeSchematicRoute(dep, arr);
      const smoothed = chaikin(result.waypoints, 3);
      return { waypoints: smoothed, meta: { method: result.method, originalCount: result.waypoints.length } };
    } finally {
      setMarnetGraphForTesting(null);
      clearSchematicRouteCache();
    }
  },
};

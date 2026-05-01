/**
 * Strategy: drop the marnet graph entirely, force coarse-A* for every
 * leg. Hypothesis: marnet's clustered-vertex problem disappears if we
 * never use it. Tradeoff: 1° A* by itself produces visible
 * cell-corner zigzags (rights-angle dogleg every cell), but we can
 * smooth those out.
 *
 * Implementation: wipes the marnet graph via the test injector, then
 * delegates to computeSchematicRoute (which falls through to
 * coarse_a_star on every leg). After the run we restore the graph.
 */
import { computeSchematicRoute, clearSchematicRouteCache } from '../../../../backend/src/services/schematicRouter';
import { setMarnetGraphForTesting, buildMarnetGraphForTesting } from '../../../../backend/src/services/marnet/marnetGraph';
import type { Strategy } from '../types';

const emptyGraph = buildMarnetGraphForTesting({ type: 'FeatureCollection', features: [] });

export const coarseOnly: Strategy = {
  name: 'coarse_only',
  description: 'Force coarse 1° A* on every leg (marnet disabled).',
  async route(dep, arr) {
    setMarnetGraphForTesting(emptyGraph);
    clearSchematicRouteCache();
    try {
      const result = await computeSchematicRoute(dep, arr);
      return { waypoints: result.waypoints, meta: { method: result.method } };
    } finally {
      setMarnetGraphForTesting(null);
      clearSchematicRouteCache();
    }
  },
};

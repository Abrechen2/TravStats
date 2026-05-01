/**
 * Strategy: marnet disabled → coarse 1° A* → arc-resample 50 km →
 * centripetal Catmull-Rom. Combines coarse-only routing with a smooth
 * rendering style.
 */
import { computeSchematicRoute, clearSchematicRouteCache } from '../../../../backend/src/services/schematicRouter';
import { setMarnetGraphForTesting, buildMarnetGraphForTesting } from '../../../../backend/src/services/marnet/marnetGraph';
import { catmullRomCentripetal, resampleArcLength } from '../geom';
import type { Strategy } from '../types';

const emptyGraph = buildMarnetGraphForTesting({ type: 'FeatureCollection', features: [] });

export const coarseResampleCentripetal: Strategy = {
  name: 'coarse_resample_centripetal',
  description: 'Coarse 1° A* → arc-resample 50 km → centripetal Catmull-Rom.',
  async route(dep, arr) {
    setMarnetGraphForTesting(emptyGraph);
    clearSchematicRouteCache();
    try {
      const result = await computeSchematicRoute(dep, arr);
      const resampled = resampleArcLength(result.waypoints, 50);
      const rendered = catmullRomCentripetal(resampled, 16);
      return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
    } finally {
      setMarnetGraphForTesting(null);
      clearSchematicRouteCache();
    }
  },
};

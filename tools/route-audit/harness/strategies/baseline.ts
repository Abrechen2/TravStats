/**
 * Strategy: production schematicRouter unmodified.
 * The reference point everything else must beat.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import type { Strategy } from '../types';

export const baseline: Strategy = {
  name: 'baseline',
  description: 'Production computeSchematicRoute() unchanged. Reference.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    return {
      waypoints: result.waypoints,
      meta: { method: result.method, routed: result.routed },
    };
  },
};

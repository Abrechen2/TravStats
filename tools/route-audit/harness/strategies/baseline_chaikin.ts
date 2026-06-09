/**
 * Strategy: production baseline → Chaikin corner-cutting (3 iterations).
 * Hypothesis A1: Chaikin's local averaging will smooth the marnet
 * cluster spikes without needing graph changes. Risk: smoothing can
 * push the polyline onto land near coast-hugging segments.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { chaikin } from '../geom';
import type { Strategy } from '../types';

export const baselineChaikin: Strategy = {
  name: 'baseline_chaikin',
  description: 'Production baseline → Chaikin corner-cutting × 3.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const smoothed = chaikin(result.waypoints, 3);
    return { waypoints: smoothed, meta: { method: result.method, originalCount: result.waypoints.length } };
  },
};

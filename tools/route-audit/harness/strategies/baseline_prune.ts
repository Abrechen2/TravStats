/**
 * Strategy: production baseline → pruneSpikeVertices (Stage 2 from
 * earlier reverted attempt). Removes any interior vertex whose bearing
 * change exceeds 100° AND whose bypass segment is all-water on the
 * fine mask. Anchored at virtual dep/arr so the corridor→marnet
 * handoff vertex is also subject to pruning.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { pruneSpikes } from '../geom';
import { makeIsLand } from '../loaders';
import type { Strategy, Waypoint } from '../types';

const isLand = makeIsLand();

function segmentAllWater(a: Waypoint, b: Waypoint): boolean {
  const dLon = b[0] - a[0];
  const dLat = b[1] - a[1];
  const segDeg = Math.hypot(dLon, dLat);
  const samples = Math.max(3, Math.ceil(segDeg / 0.15));
  for (let s = 1; s < samples; s++) {
    const t = s / samples;
    if (isLand(a[1] + dLat * t, a[0] + dLon * t)) return false;
  }
  return true;
}

export const baselinePrune: Strategy = {
  name: 'baseline_prune',
  description: 'Baseline → prune u-turn vertices (≥100° + water bypass).',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const pruned = pruneSpikes(result.waypoints, 100, segmentAllWater, 5);
    return { waypoints: pruned, meta: { method: result.method, originalCount: result.waypoints.length } };
  },
};

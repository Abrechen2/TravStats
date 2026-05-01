/**
 * Strategy: production baseline → render via centripetal Catmull-Rom
 * (α=0.5) at 16 samples per segment. Tests hypothesis A3:
 * the visual ugliness is not in the control polygon but in the
 * frontend's uniform (α=0) Catmull-Rom. Centripetal removes overshoot
 * and re-distributes the curvature so a 150° control vertex becomes a
 * milder rendered turn.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { catmullRomCentripetal } from '../geom';
import type { Strategy } from '../types';

export const baselineCentripetal: Strategy = {
  name: 'baseline_centripetal',
  description: 'Baseline → centripetal Catmull-Rom rendered curve.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const rendered = catmullRomCentripetal(result.waypoints, 16);
    return { waypoints: rendered, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

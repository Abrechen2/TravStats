/**
 * Strategy: baseline_resample_centripetal + a coast-nudge post-pass.
 * For every densified curve sample whose nearest land cell on the fine
 * mask is < 1 sample-step (0.05°), nudge the sample perpendicular to
 * its incoming tangent by 0.1° toward the side that's water. Does
 * NOT re-smooth — just minimal "stay off the cell-center" tweaks.
 *
 * The hypothesis: most "land-fraction increase" of the winner is
 * narrow-strait artefact, but if any are real, this should fix them
 * without re-introducing kinks.
 */
import { computeSchematicRoute } from '../../../../backend/src/services/schematicRouter';
import { catmullRomCentripetal, resampleArcLength } from '../geom';
import { makeIsLand } from '../loaders';
import type { Strategy, Waypoint } from '../types';

const isLand = makeIsLand();
const NUDGE_DEG = 0.1;
const NUDGE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [NUDGE_DEG, 0], [-NUDGE_DEG, 0], [0, NUDGE_DEG], [0, -NUDGE_DEG],
  [NUDGE_DEG, NUDGE_DEG], [-NUDGE_DEG, NUDGE_DEG],
  [NUDGE_DEG, -NUDGE_DEG], [-NUDGE_DEG, -NUDGE_DEG],
];

function nudgeOffLand(rendered: ReadonlyArray<Waypoint>): Waypoint[] {
  const out: Waypoint[] = [[rendered[0][0], rendered[0][1]]];
  for (let i = 1; i < rendered.length - 1; i++) {
    const [lon, lat] = rendered[i];
    if (!isLand(lat, lon)) {
      out.push([lon, lat]);
      continue;
    }
    let best: Waypoint | null = null;
    for (const [dLon, dLat] of NUDGE_OFFSETS) {
      if (!isLand(lat + dLat, lon + dLon)) {
        best = [lon + dLon, lat + dLat];
        break;
      }
    }
    out.push(best ?? [lon, lat]);
  }
  out.push([rendered[rendered.length - 1][0], rendered[rendered.length - 1][1]]);
  return out;
}

export const baselineResampleCentripetalBuffered: Strategy = {
  name: 'baseline_resample_centripetal_buffered',
  description: 'Baseline → resample 60 km → centripetal → land-nudge.',
  async route(dep, arr) {
    const result = await computeSchematicRoute(dep, arr);
    const resampled = resampleArcLength(result.waypoints, 60);
    const rendered = catmullRomCentripetal(resampled, 16);
    const nudged = nudgeOffLand(rendered);
    return { waypoints: nudged, meta: { method: result.method, controlCount: result.waypoints.length } };
  },
};

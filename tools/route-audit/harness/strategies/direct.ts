/**
 * Strategy: direct chord. Control / lower-bound on geometry quality.
 * Always emits [dep, arr]. Used to baseline what "no routing at all"
 * looks like on the metrics — the chord has 0° kinks but high
 * land-fraction on land-clipping pairs.
 */
import type { Strategy } from '../types';

export const direct: Strategy = {
  name: 'direct',
  description: 'Pure great-circle chord with no waypoints. Control.',
  async route(dep, arr) {
    return {
      waypoints: [
        [dep.lon, dep.lat],
        [arr.lon, arr.lat],
      ],
    };
  },
};

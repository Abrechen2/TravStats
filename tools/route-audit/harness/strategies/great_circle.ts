/**
 * Strategy: 24-sample great-circle. Curves naturally over the sphere
 * but ignores all land. Establishes the "best possible visual" floor
 * for transoceanic legs and the "worst possible land-violation" floor
 * for coastal legs.
 */
import { sampleGreatCircle } from '../geom';
import type { Strategy } from '../types';

export const greatCircle: Strategy = {
  name: 'great_circle',
  description: '24-sample great-circle arc. Ignores land. Sphere control.',
  async route(dep, arr) {
    const samples = sampleGreatCircle(dep, arr, 24);
    return { waypoints: samples };
  },
};

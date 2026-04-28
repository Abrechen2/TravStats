/**
 * Cruise distance orchestrator.
 *
 * Picks the most authoritative calculator for a given port pair and
 * returns a tagged ComputedLeg. Calculators are evaluated in priority
 * order — first to `accept()` wins. Haversine is always last and
 * always accepts.
 *
 * Phase progression:
 *   1 (current) — haversine only
 *   2 — + eurostat (ocean)
 *   3 — + river-osm  (inland)
 *   4 — + canal-heuristic (Panama, Suez, ...)
 */

import { haversineCalculator } from "./haversineCalculator";
import type {
  ComputedLeg,
  DistanceCalculator,
  PortPoint,
} from "./types";

const calculators: DistanceCalculator[] = [
  // Phase 2-4 calculators slot in above haversine.
  haversineCalculator,
];

export async function computeLegDistance(
  from: PortPoint,
  to: PortPoint,
): Promise<ComputedLeg> {
  for (const calc of calculators) {
    if (calc.accepts(from, to)) {
      return calc.compute(from, to);
    }
  }
  // Unreachable — haversine always accepts. Kept defensively so a
  // future refactor can't silently strip the fallback without TS
  // catching it.
  throw new Error("No DistanceCalculator accepted the port pair");
}

export type { ComputedLeg, DistanceMethod, Confidence, PortPoint } from "./types";

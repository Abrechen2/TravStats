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

import logger from "../../utils/logger";
import { haversineCalculator } from "./haversineCalculator";
import { marnetCalculator } from "./marnetCalculator";
import { riverCalculator } from "./riverCalculator";
import type {
  ComputedLeg,
  DistanceCalculator,
  PortPoint,
} from "./types";

const calculators: DistanceCalculator[] = [
  // Order matters: highest-priority calculator first. Each is tried
  // until one accepts AND its compute() succeeds. Haversine is always
  // last and always accepts.
  riverCalculator,
  marnetCalculator,
  haversineCalculator,
];

export async function computeLegDistance(
  from: PortPoint,
  to: PortPoint,
): Promise<ComputedLeg> {
  for (const calc of calculators) {
    if (!calc.accepts(from, to)) continue;
    try {
      const result = await calc.compute(from, to);
      if (result !== null) return result;
      // Calculator accepted but post-inspection declined (e.g. marnet
      // ratio < detour threshold). Continue down the chain.
    } catch (err) {
      // A calculator accepted but failed at runtime (e.g. marnet
      // route-not-found, missing data file). Log and continue to the
      // next calculator in the chain so the leg still gets a value.
      logger.warn({
        operation: "cruise_distance_calculator_failed",
        method: calc.method,
        fromPort: from.id,
        toPort: to.id,
        error: err instanceof Error ? err.message : err,
      });
    }
  }
  // Unreachable — haversine always accepts and never throws. Kept
  // defensively so a future refactor can't silently strip the fallback
  // without TS catching it.
  throw new Error("No DistanceCalculator accepted the port pair");
}

export type { ComputedLeg, DistanceMethod, Confidence, PortPoint } from "./types";

import { AppError } from "../../../middleware/errorHandler";
import type { TrackOrigin } from "../../locationProvider/entryTrack";
import type { Coverage } from "../../locationProvider/types";
import type { LonLat } from "../../travtrack/privacyCut";
import { getActualRoute, type ActualDay } from "./actualRoute";
import { comparePlanActual, type PlanActualComparison } from "./compare";
import { getPlanSnapshot } from "./planSnapshot";

export type PlanActualAnswer = PlanActualComparison & {
  plan: { revision: number };
  actual: {
    origin: TrackOrigin;
    coverage: Coverage | null;
    days: ActualDay[];
    segments: LonLat[][];
  } | null;
};

/**
 * `GET /trips/:tripId/plan/actual` (TravTrack plan L5). Reads the plan and the
 * track and writes nothing — the answer has no "apply" (review focus 29).
 * Another user's trip answers like a trip without a plan. The answer is built
 * field by field, so the comparison's server-side inputs (positions, circles)
 * never leave.
 */
export async function planVersusActual(userId: string, tripId: string): Promise<PlanActualAnswer> {
  const plan = await getPlanSnapshot(userId, tripId);
  if (!plan) throw new AppError("Plan not found", 404, "PLAN_NOT_FOUND");
  const actual = await getActualRoute(userId, tripId);
  return {
    plan: { revision: plan.revision },
    actual: actual
      ? {
          origin: actual.origin,
          coverage: actual.coverage,
          days: actual.days,
          segments: actual.segments,
        }
      : null,
    ...comparePlanActual(plan, actual),
  };
}

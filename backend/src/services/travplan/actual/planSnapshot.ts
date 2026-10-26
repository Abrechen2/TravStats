import { prisma } from "../../../db";
import { scheduleRoute } from "../routeSchedule";
import { parseState } from "../upgrade";
import type { PlanItem, PlanStage, PlanStation, RouteSchedule } from "../types";

/**
 * The plan as it stands, for comparing it with what happened (TravTrack plan
 * L5). A read of `travel_plans.state` — the active variant, which is what
 * `stations`/`stages` hold; the other variants are alternatives nobody took —
 * and nothing else: no write, no mutation row, no revision bump (review
 * focus 29). Deep-frozen, so no caller can change it on the way through.
 */
export type PlanSnapshot = Readonly<{
  revision: number;
  stations: readonly PlanStation[];
  stages: readonly PlanStage[];
  items: readonly PlanItem[];
  startDay: string | null;
  endDay: string | null;
  timezone: string | null;
  /** The plan's own calendar of the route (`scheduleRoute`), so a station's days are the plan's. */
  schedule: RouteSchedule;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Null when the trip is not this user's or has no plan — the two answer alike. */
export async function getPlanSnapshot(
  userId: string,
  tripId: string
): Promise<PlanSnapshot | null> {
  const row = await prisma.travelPlan.findFirst({
    where: { tripId, trip: { userId } },
    select: { revision: true, state: true },
  });
  if (!row) return null;
  const state = parseState(row.state);
  return deepFreeze({
    revision: row.revision,
    stations: state.stations,
    stages: state.stages,
    items: state.items,
    startDay: state.startDay,
    endDay: state.endDay,
    timezone: state.timezone,
    schedule: scheduleRoute(state),
  });
}

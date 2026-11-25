import { daysBetween } from "../../shared/time";
import type { PlanView } from "../../lib/api/travplan";

const NIGHT_CODES = ["nightGap", "nightUndecided", "hotelDates"];
const TRANSPORT_CODES = ["stageUndecided", "stageMissing", "transferOpen", "durationMissing"];

export interface ReadinessRow {
  key: "planned" | "nights" | "transport" | "tasks" | "packing";
  ok: boolean;
  to: string;
}

/**
 * A route counts as planned only when it can be read as days: two stations or
 * more, every station's arrival day known and no gap the stages leave open.
 * The skeleton the create dialog leaves (start, goal, home, no durations) is
 * not a plan — it used to show "Route steht: erledigt" on day one.
 */
function routePlanned(view: PlanView): boolean {
  const { state, schedule } = view;
  if (state.stations.length < 2 || !schedule) return false;
  if (schedule.unresolved.length > 0) return false;
  return state.stations.every((s) =>
    schedule.stations.some((d) => d.stationId === s.id && d.arriveDay !== null)
  );
}

/**
 * Nights a route accounts for: station nights in any state (spontaneous is a
 * decision, never nagged) plus a night on board per overnight stage. Fewer
 * than the trip has means nights are not settled, whatever the findings say —
 * a station left at 0 nights decided nothing.
 */
function routeNightsCovered(view: PlanView): boolean {
  const { state } = view;
  if (!state.startDay || !state.endDay) return true;
  const tripNights = daysBetween(state.startDay, state.endDay);
  const covered =
    state.stations.reduce((sum, s) => sum + s.nights, 0) +
    state.stages.filter((g) => g.overnight).length;
  return covered >= tripNights;
}

export function planReadiness(view: PlanView): ReadinessRow[] {
  const { state } = view;
  const codes = new Set(view.findings.map((f) => f.code));
  const route = state.shape === "route";
  const planned = route ? routePlanned(view) : state.items.length > 0;
  const openTasks = state.tasks.filter((x) => !x.done).length;
  const packedAll = state.packing.length > 0 && state.packing.every((p) => p.packed);
  return [
    { key: "planned", ok: planned, to: "workspace" },
    {
      key: "nights",
      ok: planned && !NIGHT_CODES.some((c) => codes.has(c)) && (!route || routeNightsCovered(view)),
      to: "workspace",
    },
    { key: "transport", ok: planned && !TRANSPORT_CODES.some((c) => codes.has(c)), to: "transfer" },
    { key: "tasks", ok: state.tasks.length > 0 && openTasks === 0, to: "packing" },
    { key: "packing", ok: packedAll, to: "packing" },
  ];
}

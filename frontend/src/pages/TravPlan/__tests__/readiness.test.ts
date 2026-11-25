import { describe, expect, it } from "vitest";
import { routePlan, routeState } from "../route/__tests__/routeFixture";
import { planReadiness } from "../readiness";

const ok = (view: ReturnType<typeof routePlan>) =>
  Object.fromEntries(planReadiness(view).map((r) => [r.key, r.ok]));

/** The skeleton the create dialog leaves: start, goal, back home, 0 nights, unmeasured drives. */
function skeleton() {
  const state = routeState({ measured: false });
  const stations = state.stations.map((s) => ({
    ...s,
    nights: 0,
    night: { kind: "spontaneous" as const },
  }));
  return routePlan({
    state: { ...state, bookings: [], stations, startDay: "2027-05-08", endDay: "2027-05-29" },
    schedule: {
      stations: [
        { stationId: "a", arriveDay: "2027-05-08", departDay: "2027-05-08" },
        { stationId: "b", arriveDay: null, departDay: null },
        { stationId: "c", arriveDay: null, departDay: null },
      ],
      stages: [],
      lastDay: null,
      conflicts: [],
      unresolved: [],
    },
  });
}

describe("plan readiness", () => {
  it("an empty route skeleton is neither planned nor has its nights settled", () => {
    const r = ok(skeleton());
    expect(r.planned).toBe(false);
    expect(r.nights).toBe(false);
  });

  it("a route whose station days are known and whose nights fill the trip is planned and settled", () => {
    const view = routePlan();
    const state = { ...view.state, endDay: "2026-05-07" };
    const r = ok({ ...view, state, findings: [] });
    expect(r.planned).toBe(true);
    expect(r.nights).toBe(true);
  });

  it("nights short of the trip length are not settled, even when every night is spontaneous", () => {
    // 2026-05-01..05-10 is nine nights; the stations cover six.
    const r = ok({ ...routePlan(), findings: [] });
    expect(r.planned).toBe(true);
    expect(r.nights).toBe(false);
  });

  it("an overnight ferry counts as a night", () => {
    const view = routePlan();
    const stages = view.state.stages.map((g, i) => (i === 0 ? { ...g, overnight: true } : g));
    const state = { ...view.state, stages, endDay: "2026-05-08" };
    expect(ok({ ...view, state, findings: [] }).nights).toBe(true);
  });
});

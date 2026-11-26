import { describe, it, expect } from "vitest";
import { insertStop } from "../insertStop";
import { place, routeState } from "./routeFixture";
import type {
  PlanOperation,
  PlanStage,
  PlanState,
  PlanStation,
} from "../../../../lib/api/travplan";

/** Applies the operations the way the server does, enough to read the resulting route. */
function apply(state: PlanState, ops: PlanOperation[]): PlanState {
  return ops.reduce((s, op) => {
    if (op.type === "move_station") {
      const rest = s.stations.filter((x) => x.id !== op.id);
      const moved = s.stations.find((x) => x.id === op.id)!;
      return { ...s, stations: [...rest.slice(0, op.toIndex), moved, ...rest.slice(op.toIndex)] };
    }
    if (op.type !== "upsert") throw new Error("unexpected " + op.type);
    const key = op.collection as "stations" | "stages";
    const value = op.value as unknown as PlanStation & PlanStage;
    const list = s[key] as { id: string }[];
    const next = list.some((x) => x.id === value.id)
      ? list.map((x) => (x.id === value.id ? value : x))
      : [...list, value];
    return { ...s, [key]: next };
  }, state);
}

const legs = (s: PlanState) =>
  s.stations.slice(0, -1).map((a, i) => {
    const b = s.stations[i + 1],
      g = s.stages.find((x) => x.fromStationId === a.id && x.toStationId === b.id);
    return `${a.title}>${g ? g.mode : "?"}>${b.title}`;
  });

const cefalu = place("Cefalù", 38.04, 14.02);

describe("insertStop", () => {
  it("splits a drive: the old leg arrives at the stop, a new drive goes on", () => {
    const before = routeState();
    const operations = insertStop(before, 0, cefalu);
    const after = apply(before, operations);
    expect(legs(after)).toEqual([
      "Kiel>drive>Cefalù",
      "Cefalù>drive>Gothenburg",
      "Gothenburg>drive>Oslo",
    ]);
    const first = after.stages.find((g) => g.id === "g1")!;
    expect(first).toMatchObject({
      toStationId: after.stations[1].id,
      distanceKm: null,
      durationMinutes: null,
    });
  });

  it("turns a stop before a ferry into a round trip from the port, the ferry untouched", () => {
    const base = routeState();
    const before: PlanState = {
      ...base,
      stages: base.stages.map((g) =>
        g.id === "g2" ? { ...g, mode: "ferry", bookingId: "bk-hold" } : g
      ),
    };
    const operations = insertStop(before, 1, cefalu);
    const after = apply(before, operations);
    expect(legs(after)).toEqual([
      "Kiel>drive>Gothenburg",
      "Gothenburg>drive>Cefalù",
      "Cefalù>drive>Gothenburg",
      "Gothenburg>ferry>Oslo",
    ]);
    expect(after.stages.find((g) => g.id === "g2")).toMatchObject({
      mode: "ferry",
      bookingId: "bk-hold",
    });
    // The port copy holds no nights; the stop holds one.
    expect(after.stations.map((s) => s.nights)).toEqual([2, 1, 1, 0, 3]);
  });

  it("after the last station only adds the way there", () => {
    const before = routeState();
    const after = apply(before, insertStop(before, 2, cefalu));
    expect(legs(after)).toEqual([
      "Kiel>drive>Gothenburg",
      "Gothenburg>drive>Oslo",
      "Oslo>drive>Cefalù",
    ]);
  });
});

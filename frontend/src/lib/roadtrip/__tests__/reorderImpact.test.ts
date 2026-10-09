import { describe, expect, it } from "vitest";

import type { TourLeg } from "../../../types/tour";
import { moveStation, reorderImpact, type ReorderStation } from "../reorderImpact";

const st = (id: string, startDate: string | null = null): ReorderStation => ({
  key: id,
  id,
  title: id.toUpperCase(),
  lat: 60,
  lon: 5,
  startDate,
  endDate: null,
  notes: null,
  night: { kind: "pass" },
});
const leg = (from: string, to: string, source: TourLeg["source"]): TourLeg => ({
  id: `${from}${to}`,
  fromStopId: from,
  toStopId: to,
  distanceKm: 42,
  source,
  mode: "road",
  confidence: "high",
  waypoints: null,
  drivingMinutes: null,
});

/** forgejo#242: what a move costs, before it is made. */
describe("reorderImpact", () => {
  const list = [
    st("a", "2026-07-10"),
    st("b", "2026-07-11"),
    st("c", "2026-07-12"),
    st("d", "2026-07-13"),
  ];
  const legs = [leg("a", "b", "routed"), leg("b", "c", "track"), leg("c", "d", "drawn")];

  it("names the new neighbours", () => {
    const up = reorderImpact(list, legs, 2, 1);
    expect(up.before?.key).toBe("a");
    expect(up.after?.key).toBe("b");
    expect(reorderImpact(list, legs, 1, 0).before).toBeNull();
    expect(reorderImpact(list, legs, 2, 3).after).toBeNull();
  });

  it("lists every leg whose stations stop being adjacent, and the pairs that become adjacent", () => {
    const impact = reorderImpact(list, legs, 2, 1); // a c b d
    expect(impact.dropped.map((d) => `${d.from.key}${d.to.key}:${d.leg?.source}`)).toEqual([
      "ab:routed",
      "bc:track",
      "cd:drawn",
    ]);
    expect(impact.created.map((c) => `${c.from.key}${c.to.key}`)).toEqual(["ac", "cb", "bd"]);
  });

  it("says a recorded or hand-drawn line would be lost, and not for a routed or straight one", () => {
    expect(reorderImpact(list, legs, 2, 1).losesLine).toBe(true);
    const plain = [leg("a", "b", "routed"), leg("b", "c", "straight"), leg("c", "d", "straight")];
    expect(reorderImpact(list, plain, 3, 2).losesLine).toBe(false);
  });

  it("flags a date that would read backwards — only when the move causes it", () => {
    const impact = reorderImpact(list, legs, 2, 1); // c (12th) now before b (11th)
    expect(impact.dateConflicts.map((c) => `${c.station.key}<${c.previous.key}`)).toEqual(["b<c"]);
    const wasAlready = [st("a", "2026-07-12"), st("b", "2026-07-11"), st("c")];
    expect(reorderImpact(wasAlready, [], 2, 1).dateConflicts).toEqual([]);
  });

  it("moves an item and leaves the rest in order", () => {
    expect(moveStation(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
});

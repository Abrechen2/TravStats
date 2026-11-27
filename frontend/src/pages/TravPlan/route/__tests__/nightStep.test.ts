import { describe, it, expect } from "vitest";
import { fixedAfter } from "../nightStep";
import { routeState } from "./routeFixture";

describe("fixedAfter", () => {
  it("names a later booked leg and a pinned station, earliest first, and ignores placeholders", () => {
    const base = routeState();
    const state = {
      ...base,
      stations: base.stations.map((s) => (s.id === "c" ? { ...s, pinnedDay: "2026-05-06" } : s)),
      stages: base.stages.map((g) =>
        g.id === "g2" ? { ...g, bookingId: "bk-booked" } : { ...g, bookingId: "bk-hold" }
      ),
    };
    expect(fixedAfter(state, "a")).toEqual([
      { title: "Kiel - Gothenburg", day: "2026-05-03" },
      { title: "Oslo", day: "2026-05-06" },
    ]);
    // From Oslo, nothing follows.
    expect(fixedAfter(state, "c")).toEqual([]);
  });

  it("does not count a leg that lies before the station", () => {
    const base = routeState();
    const state = { ...base, stages: base.stages.map((g) => ({ ...g, bookingId: "bk-booked" })) };
    expect(fixedAfter(state, "b").map((f) => f.title)).toEqual(["Kiel - Gothenburg"]);
  });
});

import { describe, expect, it } from "vitest";
import { computeRailStates } from "../timelineRail";

const NOW = new Date("2026-07-15T12:00:00Z").getTime();

describe("computeRailStates", () => {
  it("returns an empty array for no events", () => {
    expect(computeRailStates([], NOW)).toEqual([]);
  });

  it("marks past dots and fills the rail up to the last past dot", () => {
    const states = computeRailStates(
      ["2026-07-10T08:00:00Z", "2026-07-14T08:00:00Z", "2026-07-20T08:00:00Z"],
      NOW
    );
    expect(states.map((s) => s.dotPast)).toEqual([true, true, false]);
    // Segment between two dots is filled only when the later event is past.
    expect(states[1].topFilled).toBe(true);
    expect(states[1].bottomFilled).toBe(false);
    expect(states[2].topFilled).toBe(false);
  });

  it("keeps the whole rail neutral for a fully upcoming trip", () => {
    const states = computeRailStates(["2026-08-01T08:00:00Z", "2026-08-05T08:00:00Z"], NOW);
    expect(states.every((s) => !s.dotPast && !s.topFilled && !s.bottomFilled)).toBe(true);
  });

  it("fills the whole rail for a fully past trip", () => {
    const states = computeRailStates(["2026-06-01T08:00:00Z", "2026-06-05T08:00:00Z"], NOW);
    expect(states.every((s) => s.dotPast && s.topFilled)).toBe(true);
    expect(states[0].bottomFilled).toBe(true);
    // The last dot has no next event, so its bottom segment stays unfilled
    // (it is not rendered for the last item anyway).
    expect(states[1].bottomFilled).toBe(false);
  });

  it("treats an event exactly at now as past", () => {
    const states = computeRailStates(["2026-07-15T12:00:00Z"], NOW);
    expect(states[0].dotPast).toBe(true);
  });

  it("handles date-only strings (stops and journal entries)", () => {
    const states = computeRailStates(["2026-07-14", "2026-07-16"], NOW);
    expect(states.map((s) => s.dotPast)).toEqual([true, false]);
  });
});

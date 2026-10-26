import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import { clipStretches, dayBarOf, sectionFacts } from "../sectionGeometry";

/**
 * The section's arithmetic (owner, 2026-10-26): on the server's safe
 * stretches only, never across the step from one stretch to the next — that
 * step is a privacy zone, a deletion or a pause, and counts as nothing.
 */

const T = Date.parse("2026-10-20T08:00:00Z");
const MIN = 60_000;
const p = (minute: number, lat: number, lon: number): TrackPoint => [T + minute * MIN, lat, lon, 5];

describe("clipStretches", () => {
  it("cuts each stretch to the window and never joins two stretches", () => {
    const parts = [
      { segments: [[p(0, 50, 8), p(10, 50.1, 8), p(20, 50.2, 8)]] },
      { segments: [[p(30, 51, 9), p(40, 51.1, 9)]] },
    ];
    const clipped = clipStretches(parts, { fromMs: T + 10 * MIN, untilMs: T + 40 * MIN });
    expect(clipped).toEqual([[p(10, 50.1, 8), p(20, 50.2, 8)], [p(30, 51, 9)]]);
  });

  it("drops a stretch with nothing inside the window", () => {
    const parts = [{ segments: [[p(0, 50, 8)], [p(50, 51, 9)]] }];
    expect(clipStretches(parts, { fromMs: T + 40 * MIN, untilMs: T + 60 * MIN })).toEqual([
      [p(50, 51, 9)],
    ]);
  });
});

describe("sectionFacts", () => {
  it("does not sum the distance across a cut between two stretches", () => {
    const one = [p(0, 50, 8), p(10, 50.1, 8)];
    const two = [p(20, 52, 10), p(30, 52.1, 10)];
    const joined = sectionFacts([[...one, ...two]]);
    const cut = sectionFacts([one, two]);
    // Two stretches of ~11.1 km each; the 200+ km step between them is not travel shown.
    expect(cut.distanceM).toBeGreaterThan(22_000);
    expect(cut.distanceM).toBeLessThan(22_500);
    expect(joined.distanceM).toBeGreaterThan(200_000);
    expect(cut.cuts).toBe(1);
    expect(cut.points).toBe(4);
  });

  it("abstains with single fixes: no distance and no speed, never 0", () => {
    const facts = sectionFacts([[p(0, 50, 8)], [p(30, 51, 9)]]);
    expect(facts).toMatchObject({ distanceM: null, avgKmh: null, maxKmh: null, points: 2 });
    expect(facts.firstMs).toBe(T);
    expect(facts.lastMs).toBe(T + 30 * MIN);
  });

  it("an instant jump is not the top speed", () => {
    // 11.1 km in 10 min (~67 km/h), then 111 km in one second.
    const facts = sectionFacts([[p(0, 50, 8), p(10, 50.1, 8), [T + 10 * MIN + 1_000, 51.1, 8, 5]]]);
    expect(facts.maxKmh).toBeGreaterThan(60);
    expect(facts.maxKmh).toBeLessThan(80);
  });

  it("an empty section says nothing", () => {
    expect(sectionFacts([])).toMatchObject({
      distanceM: null,
      points: 0,
      firstMs: null,
      cuts: 0,
    });
  });
});

describe("dayBarOf", () => {
  it("marks the share of 24 h, and refuses an empty window", () => {
    expect(dayBarOf(360, 720)).toEqual({ left: 25, width: 25 });
    expect(dayBarOf(720, 720)).toBeNull();
  });
});

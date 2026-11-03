import { describe, expect, it } from "vitest";
import type { TravTrackRange } from "../../../../lib/api/travtrackViews";
import type { RangeTotals } from "../trackGeometry";
import { totalsFromAggregates } from "../trackLegs";

const base: RangeTotals = { distanceM: 1, movingMs: 1, avgKmh: 1, points: 9, coverage: 0.5 };
const part = (aggregates?: TravTrackRange["aggregates"]): TravTrackRange =>
  ({ aggregates }) as TravTrackRange;

describe("totalsFromAggregates", () => {
  it("takes distance, moving time and top speed from the server, not from the drawing", () => {
    const out = totalsFromAggregates(base, [
      part({ distanceM: 10_000, movingMs: 3_600_000, maxSpeedMps: 10 }),
      part({ distanceM: 5_000, movingMs: 1_800_000, maxSpeedMps: 25 }),
    ]);
    expect(out.distanceM).toBe(15_000);
    expect(out.movingMs).toBe(5_400_000);
    // 15 km over 1.5 h: one basis with the distance and moving time, not the drawing's ratio.
    expect(out.avgKmh).toBeCloseTo(10);
    expect(out.maxKmh).toBeCloseTo(90);
    expect(out.points).toBe(9);
  });

  it("keeps the unknown unknown: a part without moving time makes it null, never 0", () => {
    const out = totalsFromAggregates(base, [
      part({ distanceM: 10_000, movingMs: null, maxSpeedMps: null }),
      part({ distanceM: 5_000, movingMs: 1_800_000, maxSpeedMps: null }),
    ]);
    expect(out.movingMs).toBeNull();
    expect(out.avgKmh).toBeNull();
    expect(out.maxKmh).toBeNull();
  });

  it("falls back to the drawing when any part comes from a server without aggregates", () => {
    expect(
      totalsFromAggregates(base, [part({ distanceM: 1, movingMs: 1, maxSpeedMps: 1 }), part()])
    ).toBe(base);
    expect(totalsFromAggregates(base, [])).toBe(base);
  });
});

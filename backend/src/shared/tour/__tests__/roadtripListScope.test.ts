/**
 * The truth table of `shared/tour/roadtripListScope.ts` — MIRRORED between
 * backend and frontend, each side runs this same table.
 */
import { roadtripCountsIn } from "../roadtripListScope";

const NOW = new Date("2026-07-15T12:00:00Z");

describe("roadtripCountsIn", () => {
  it("counts a started roadtrip in the year it started, and in the lifetime view", () => {
    expect(roadtripCountsIn("2026-07-01T00:00:00.000Z", 2026, NOW)).toBe(true);
    expect(roadtripCountsIn("2025-12-30T00:00:00.000Z", 2026, NOW)).toBe(false);
    expect(roadtripCountsIn("2025-12-30T00:00:00.000Z", null, NOW)).toBe(true);
  });

  it("counts a roadtrip that has not started nowhere — not even in the lifetime view", () => {
    expect(roadtripCountsIn("2026-07-20T00:00:00.000Z", null, NOW)).toBe(false);
    expect(roadtripCountsIn("2026-07-20T00:00:00.000Z", 2026, NOW)).toBe(false);
  });

  it("counts an undated roadtrip in the lifetime view and in no year", () => {
    expect(roadtripCountsIn(null, null, NOW)).toBe(true);
    expect(roadtripCountsIn(null, 2026, NOW)).toBe(false);
  });
});

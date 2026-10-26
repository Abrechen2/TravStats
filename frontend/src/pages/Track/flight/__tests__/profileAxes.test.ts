import { describe, expect, it } from "vitest";
import type { FlightSample } from "../../../../lib/api/travtrackViews";
import { profileFrame } from "../altitudeProfile";
import {
  areaPaths,
  gapBands,
  nearestIndex,
  niceTicks,
  speedPaths,
  timeTicks,
  topSpeedKmh,
} from "../profileAxes";

/**
 * The profile's axes and overlays (owner 2026-10-26): round ticks, clock
 * ticks in the departure zone with a mark at local midnight, a band where the
 * recording breaks, and lines that never run from one stretch into the next.
 */

const H = 3_600_000;

describe("profileAxes", () => {
  it("round ticks reach past the top", () => {
    expect(niceTicks(12_173)).toEqual([0, 5000, 10000, 15000]);
    expect(niceTicks(950)).toEqual([0, 500, 1000]);
    expect(niceTicks(900, 5)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(0)).toEqual([0]);
  });

  it("clock ticks sit on the departure zone's whole hours and mark its midnight", () => {
    // 20:30 UTC to 02:30 UTC is 02:00 to 08:00 in Kolkata (+05:30): no midnight there.
    const t0 = Date.parse("2026-10-03T20:30:00Z");
    const kolkata = timeTicks(t0, t0 + 6 * H, "Asia/Kolkata");
    expect(kolkata.ticks[0]).toBe(t0);
    expect(kolkata.midnights).toEqual([]);
    // The same span in Berlin (+02:00) crosses local midnight at 22:00 UTC.
    const berlin = timeTicks(t0, t0 + 6 * H, "Europe/Berlin");
    expect(berlin.midnights).toEqual([Date.parse("2026-10-03T22:00:00Z")]);
    expect(berlin.ticks.length).toBeLessThanOrEqual(7);
  });

  it("a band lies between two stretches, never inside one", () => {
    const series: FlightSample[][] = [
      [
        [0, 100, 50],
        [10 * 60_000, 9000, 230],
      ],
      [
        [60 * 60_000, 9500, 240],
        [70 * 60_000, 9000, 240],
      ],
      [[70 * 60_000 + 30_000, 8000, 230]],
    ];
    // The last break is 30 s: too short to call a gap in the recording.
    expect(gapBands(series)).toEqual([[10 * 60_000, 60 * 60_000]]);
  });

  it("the area and the speed line break where a stretch or a value breaks", () => {
    const series: FlightSample[][] = [
      [
        [0, 100, 50],
        [60_000, 3000, null],
        [120_000, 6000, 200],
        [180_000, 9000, 230],
      ],
      [
        [600_000, 9000, 240],
        [660_000, 8000, 240],
      ],
    ];
    const frame = profileFrame(series, 600, 100)!;
    expect(areaPaths(series, frame)).toHaveLength(2);
    expect(speedPaths(series, frame, 1000)).toHaveLength(2);
    expect(areaPaths(series, frame).every((d) => d.endsWith("Z"))).toBe(true);
    expect(topSpeedKmh(series)).toBeCloseTo(864, 5);
  });

  it("the nearest sample to an instant", () => {
    const samples: FlightSample[] = [
      [0, 1, 1],
      [10, 2, 2],
      [20, 3, 3],
    ];
    expect(nearestIndex(samples, 14)).toBe(1);
    expect(nearestIndex(samples, 16)).toBe(2);
    expect(nearestIndex(samples, -5)).toBe(0);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

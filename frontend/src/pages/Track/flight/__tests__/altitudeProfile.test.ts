import { describe, expect, it } from "vitest";
import type { FlightSample } from "../../../../lib/api/travtrackViews";
import { altitudeAt, flightLevel, profileFrame, profilePaths } from "../altitudeProfile";

/**
 * The altitude profile (plan T5.3) never draws across a cut: a new stretch
 * and a sample without altitude both break the line, and no altitude is
 * told between two stretches.
 */

const series: FlightSample[][] = [
  [
    [0, 100, 70],
    [60, 3000, 200],
    [120, null, 230],
    [180, 9000, 240],
    [240, 10000, 250],
  ],
  [
    [600, 10000, 250],
    [660, 8000, 240],
  ],
];

describe("altitudeProfile", () => {
  it("one path per unbroken run of altitudes", () => {
    const frame = profileFrame(series, 600, 100)!;
    const paths = profilePaths(series, frame);
    expect(paths).toHaveLength(3);
    expect(paths.every((d) => d.startsWith("M"))).toBe(true);
    expect(frame).toMatchObject({ t0: 0, t1: 660, top: 10000 });
  });

  it("an altitude inside a stretch is interpolated; in a cut or by a gap it is unknown", () => {
    expect(altitudeAt(series, 30)).toBeCloseTo(1550, 5);
    expect(altitudeAt(series, 90)).toBeNull();
    expect(altitudeAt(series, 400)).toBeNull();
    expect(altitudeAt(series, 600)).toBe(10000);
  });

  it("nothing recorded has no frame; metres read as a flight level", () => {
    expect(profileFrame([], 600, 100)).toBeNull();
    expect(flightLevel(10_668)).toBe(350);
  });
});

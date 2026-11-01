import { describe, it, expect } from "@jest/globals";

import { movementRuns } from "../segment";
import { stopDriveStop } from "./journeyPoints";

/**
 * forgejo#400 — the mode hint reads the phone's reported speed when the run
 * carries it, because a step between sparse fixes averages a train's peak
 * away; a spike or an impossible value never moves the hint.
 */

const T0 = Date.parse("2026-10-20T06:00:00Z");
const opts = (points: { atMs: number }[]) => ({
  readFromMs: points[0].atMs - 3 * 3_600_000,
  readUntilMs: points[points.length - 1].atMs + 3 * 3_600_000,
  circles: [],
});

/** A 100 km/h-by-steps run whose fixes report `mps` while moving. */
const withSpeed = (mps: number | null) =>
  stopDriveStop(T0, 90, 100).map((p, i, all) => {
    const moving = i > 0 && i < all.length - 1 && p.lon !== all[i - 1].lon;
    return moving ? { ...p, speedMps: mps } : p;
  });

describe("journey mode hint from reported speed", () => {
  it("reads rail from a reported 200 km/h even though the steps average 100 km/h", () => {
    const points = withSpeed(200 / 3.6);
    const [run] = movementRuns(points, opts(points));
    expect(run.medianKmh).toBeLessThan(110); // acceptance is still the step median
    expect(run.modeHint).toBe("rail");
  });

  it("falls back to the steps when the reported speeds are impossible (a GPS spike)", () => {
    const points = withSpeed(300); // 1080 km/h
    expect(movementRuns(points, opts(points))[0].modeHint).toBe("road");
  });

  it("falls back to the steps when too few fixes carry a speed", () => {
    const points = withSpeed(200 / 3.6).map((p, i) => (i % 4 === 0 ? p : { ...p, speedMps: null }));
    expect(movementRuns(points, opts(points))[0].modeHint).toBe("road");
  });
});

import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import { parsePrefs } from "../../../../lib/webPrefs/trackMap";
import { SPEED_STOPS, speedColor } from "../trackGeometry";
import type { MapPoint } from "../trackMapLayers";
import { legFitPadding } from "../trackLegs";
import { filterByAccuracy, speedStopsFor } from "../trackSpeedScale";

const pt = (accuracy: number | null): MapPoint => ({
  point: [0, 0, 0, accuracy] as TrackPoint,
  zone: "UTC",
  id: null,
});

describe("speed scale presets", () => {
  it("the default preset is the original ramp; a preset moves the speeds, not the colours", () => {
    expect(speedStopsFor("default", [])).toEqual(SPEED_STOPS);
    const walk = speedStopsFor("walk", []);
    expect(walk.map((s) => s.rgb)).toEqual(SPEED_STOPS.map((s) => s.rgb));
    expect(walk[walk.length - 1].kmh).toBe(8);
    expect(speedStopsFor("car", [])[3].kmh).toBe(130);
    // 20 km/h is hot on the walking scale and cool on the default one.
    expect(speedColor(20, walk)).not.toEqual(speedColor(20));
  });

  it("auto fits the ramp to the shown track and never goes below its floor", () => {
    // 1° of latitude in 1 h is ~111 km/h.
    const fast: TrackPoint[] = [
      [0, 0, 0, null],
      [3_600_000, 1, 0, null],
    ];
    expect(speedStopsFor("auto", [fast])[3].kmh).toBe(112);
    const still: TrackPoint[] = [
      [0, 0, 0, null],
      [3_600_000, 0.00001, 0, null],
    ];
    expect(speedStopsFor("auto", [still])[3].kmh).toBe(8);
    expect(speedStopsFor("auto", [])).toEqual(SPEED_STOPS);
  });
});

describe("accuracy filter", () => {
  it("drops points worse than the limit, keeps unknown accuracy, and off keeps the same array", () => {
    const all = [pt(10), pt(80), pt(null)];
    expect(filterByAccuracy(all, 50)).toEqual([all[0], all[2]]);
    expect(filterByAccuracy(all, null)).toBe(all);
  });
});

describe("prefs and framing", () => {
  it("a stored scale and limit round-trip; unknown values fall back", () => {
    expect(parsePrefs(JSON.stringify({ speedScale: "cycle", maxAccuracyM: 100 }))).toMatchObject({
      speedScale: "cycle",
      maxAccuracyM: 100,
    });
    expect(parsePrefs(JSON.stringify({ speedScale: "x", maxAccuracyM: 7 }))).toMatchObject({
      speedScale: "default",
      maxAccuracyM: null,
    });
  });

  it("leg framing leaves the card's width on a tablet and its height on a phone", () => {
    expect(legFitPadding(false).left).toBeGreaterThanOrEqual(332);
    expect(legFitPadding(true).bottom).toBeGreaterThanOrEqual(300);
    expect(legFitPadding(true).left).toBeLessThan(100);
  });
});

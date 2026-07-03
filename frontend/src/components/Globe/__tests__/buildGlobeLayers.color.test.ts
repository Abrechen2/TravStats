import { describe, it, expect } from "vitest";
import { resolveFlightArcColor } from "../buildGlobeLayers";
import type { HeatmapThresholds } from "../heatmapUtils";

const HEATMAP_FALLBACK: [number, number, number] = [100, 116, 139];
const OVERRIDE: [number, number, number] = [255, 0, 255];

// Thresholds spanning a real spread (q25=1, q50=2, q75=5) so the
// low/high frequency test cases below land on distinct intensities
// instead of the degenerate single-route case where count === every
// threshold.
const THRESHOLDS: HeatmapThresholds = { q25: 1, q50: 2, q75: 5, max: 10 };

describe("resolveFlightArcColor", () => {
  it("colors a high-frequency past-family route vivid orange in two-tone mode", () => {
    expect(
      resolveFlightArcColor("past", HEATMAP_FALLBACK, 10, THRESHOLDS, { statusTwoTone: true })
    ).toEqual([249, 115, 22]);
  });

  it("colors a low-frequency past-family route amber-ish (not vivid orange) in two-tone mode", () => {
    // count(1) <= q25(1) → the 0.2 intensity floor, not 0 — so this is a
    // point near FLIGHT_PAST_LOW ([240,169,71]) but not identical to it.
    expect(
      resolveFlightArcColor("past", HEATMAP_FALLBACK, 1, THRESHOLDS, { statusTwoTone: true })
    ).toEqual([242, 158, 61]);
  });

  it("colors a high-frequency pure-scheduled route sky-blue in two-tone mode", () => {
    expect(
      resolveFlightArcColor("scheduled", HEATMAP_FALLBACK, 10, THRESHOLDS, { statusTwoTone: true })
    ).toEqual([80, 200, 255]);
  });

  it("colors a low-frequency pure-scheduled route soft blue (not sky-blue) in two-tone mode", () => {
    // count(1) <= q25(1) → the 0.2 intensity floor, not 0 — a point near
    // FLIGHT_SCHEDULED_LOW ([130,195,235]) but not identical to it.
    expect(
      resolveFlightArcColor("scheduled", HEATMAP_FALLBACK, 1, THRESHOLDS, { statusTwoTone: true })
    ).toEqual([120, 196, 239]);
  });

  it("two-tone mode ignores flightRouteColor — status wins", () => {
    expect(
      resolveFlightArcColor("past", HEATMAP_FALLBACK, 10, THRESHOLDS, {
        statusTwoTone: true,
        flightRouteColor: OVERRIDE,
      })
    ).toEqual([249, 115, 22]);
  });

  it("without two-tone, flightRouteColor overrides regardless of status", () => {
    expect(
      resolveFlightArcColor("scheduled", HEATMAP_FALLBACK, 10, THRESHOLDS, {
        flightRouteColor: OVERRIDE,
      })
    ).toEqual(OVERRIDE);
  });

  it("without two-tone and no override, falls back to the heatmap color (regression guard)", () => {
    expect(resolveFlightArcColor("past", HEATMAP_FALLBACK, 10, THRESHOLDS, {})).toEqual(
      HEATMAP_FALLBACK
    );
  });
});

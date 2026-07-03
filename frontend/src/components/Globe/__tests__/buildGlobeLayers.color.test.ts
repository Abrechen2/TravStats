import { describe, it, expect } from "vitest";
import { resolveFlightArcColor } from "../buildGlobeLayers";

const HEATMAP_FALLBACK: [number, number, number] = [100, 116, 139];
const OVERRIDE: [number, number, number] = [255, 0, 255];

describe("resolveFlightArcColor", () => {
  it("colors a past-family route orange in two-tone mode", () => {
    expect(resolveFlightArcColor("past", HEATMAP_FALLBACK, { statusTwoTone: true })).toEqual([
      240, 169, 71,
    ]);
  });

  it("colors a pure-scheduled route gold in two-tone mode", () => {
    expect(
      resolveFlightArcColor("scheduled", HEATMAP_FALLBACK, { statusTwoTone: true })
    ).toEqual([242, 201, 76]);
  });

  it("two-tone mode ignores flightRouteColor — status wins", () => {
    expect(
      resolveFlightArcColor("past", HEATMAP_FALLBACK, {
        statusTwoTone: true,
        flightRouteColor: OVERRIDE,
      })
    ).toEqual([240, 169, 71]);
  });

  it("without two-tone, flightRouteColor overrides regardless of status", () => {
    expect(
      resolveFlightArcColor("scheduled", HEATMAP_FALLBACK, { flightRouteColor: OVERRIDE })
    ).toEqual(OVERRIDE);
  });

  it("without two-tone and no override, falls back to the heatmap color (regression guard)", () => {
    expect(resolveFlightArcColor("past", HEATMAP_FALLBACK, {})).toEqual(HEATMAP_FALLBACK);
  });
});

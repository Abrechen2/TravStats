import { describe, it, expect } from "vitest";
import { resolveFlightArcColor, resolveCruisePathColor } from "../buildGlobeLayers";

const HEATMAP_FALLBACK: [number, number, number] = [100, 116, 139];
const OVERRIDE: [number, number, number] = [255, 0, 255];

describe("resolveFlightArcColor", () => {
  it("colors a past-family route orange in two-tone mode", () => {
    expect(resolveFlightArcColor("past", HEATMAP_FALLBACK, { statusTwoTone: true })).toEqual([
      240, 169, 71,
    ]);
  });

  it("colors a pure-scheduled route coral in two-tone mode", () => {
    expect(
      resolveFlightArcColor("scheduled", HEATMAP_FALLBACK, { statusTwoTone: true })
    ).toEqual([251, 113, 133]);
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

describe("resolveCruisePathColor", () => {
  const CRUISE_PAST: [number, number, number] = [74, 144, 217];
  const CRUISE_PLANNED: [number, number, number] = [34, 211, 238];

  it("renders a past cruise at full alpha", () => {
    expect(resolveCruisePathColor({ status: "flown", color: CRUISE_PAST })).toEqual([
      74, 144, 217, 230,
    ]);
  });

  it("dims a planned (scheduled) cruise — parity with the flat map", () => {
    expect(resolveCruisePathColor({ status: "scheduled", color: CRUISE_PLANNED })).toEqual([
      34, 211, 238, 150,
    ]);
  });

  it("keeps a per-cruise hue but still dims it when scheduled", () => {
    const perCruise: [number, number, number] = [232, 131, 116];
    expect(resolveCruisePathColor({ status: "scheduled", color: perCruise })).toEqual([
      232, 131, 116, 150,
    ]);
  });
});

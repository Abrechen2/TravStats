import { describe, it, expect } from "vitest";
import { resolveAirportDotColor } from "./markerDotStyle";
import { MAP_LAYER_COLORS } from "../../types/mapTheme";

/**
 * The airport dot's colour is a THREE-step fallback, and this test exists
 * because the doc-comment beside it said it was two — that the literal at the
 * end had been deleted. It had not. A sentence describing an invariant the
 * code does not hold is worse than no sentence: the next reader trusts it.
 *
 * The third step stays, because `themeColors` really is optional in
 * `createRoutesLayers` — the parameter is `themeColors?: MapLayerColors`, and
 * every test in this tree calls it without one. Deleting the literal would
 * have turned those calls into `undefined` reaching `getFillColor`, which
 * deck.gl renders as black.
 */
describe("resolveAirportDotColor", () => {
  const theme = MAP_LAYER_COLORS.glassmorphism;

  it("prefers the user's marker colour over everything else", () => {
    expect(resolveAirportDotColor([1, 2, 3], theme)).toEqual([1, 2, 3]);
  });

  it("falls back to the map theme when the user set no colour", () => {
    expect(resolveAirportDotColor(null, theme)).toEqual(theme.airportDot);
    expect(resolveAirportDotColor(undefined, theme)).toEqual(theme.airportDot);
  });

  it("still answers when no theme was passed at all — the step that is NOT dead", () => {
    // `createRoutesLayers(routeData)` with no theme is a real call shape, so
    // this branch is reachable from production code, not only from a test.
    const fallback = resolveAirportDotColor(null, undefined);
    expect(fallback).toHaveLength(3);
    for (const channel of fallback) {
      expect(Number.isInteger(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    // It agrees with the theme it stands in for, so a themeless caller and a
    // themed one draw the same dot rather than two different ambers.
    expect(fallback).toEqual(theme.airportDot);
  });
});

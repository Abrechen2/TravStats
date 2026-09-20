// Shared sizing model for the flat map's single-point "you were here"
// markers — the airport dot (`routes-dot` in routesLayer.ts) and the
// cruise-port dot (`cruise-ports` in cruisePortsLayer.ts).
//
// #187: both dots used the same 2200 m base radius constant, but the two
// layers scaled it with the user's size slider in fundamentally different
// ways:
//   - the airport dot scaled the *metre* radius directly
//     (`getRadius: () => 2200 * markerSizeScale`) with no pixel clamp at
//     all, so it collapsed to sub-pixel at low zoom and ballooned to
//     cover a whole city at high zoom;
//   - the port dot kept the metre radius fixed and instead clamped the
//     *pixel* size via `radiusMinPixels` / `radiusMaxPixels` (scaled by
//     the slider) — see the original comment on PORT_DOT_RADIUS_M, which
//     already explained why an unclamped metre radius is wrong.
// Net effect: choosing the same slider value for both markers rendered
// two visibly different dot sizes at most zoom levels.
//
// The port's model is the correct one. Both layers now derive their dot
// radius props from this single module so they cannot drift apart again.
// This governs ONLY the solid centre dot — the airport's count-scaled
// frequency ring and the port's halo ring are unrelated and unaffected.

import type { MapLayerColors } from "../../types/mapTheme";

/**
 * The airport dot's colour: the user's marker override, else the map theme's
 * own, else a literal.
 *
 * THREE steps, and all three are live. It lived inline in `routesLayer.ts`
 * and moved here because the trip map (`Trips/tripMapColors.ts`) needs the
 * same answer, and a second copy of a three-step fallback is a second chance
 * to get the order wrong.
 *
 * An earlier version of this comment claimed the literal had been deleted
 * because "the theme always carries an airportDot". The theme does — but
 * `themeColors` is OPTIONAL in `createRoutesLayers`, and callers pass nothing
 * (every routes-layer test does). Without the literal those calls reach
 * `getFillColor` with `undefined`, which deck.gl draws black. The step is a
 * guard against an absent theme, not against an incomplete one, and
 * `markerDotStyle.test.ts` exercises it.
 */
export function resolveAirportDotColor(
  markerColor: [number, number, number] | null | undefined,
  themeColors: Pick<MapLayerColors, "airportDot"> | undefined
): [number, number, number] {
  return markerColor ?? themeColors?.airportDot ?? MAP_FALLBACK_AIRPORT_DOT;
}

/** Used when a caller passes no theme at all. Deliberately equal to
 *  `MAP_LAYER_COLORS.*.airportDot` — both themes agree on it — so a themeless
 *  caller and a themed one draw the same dot rather than two ambers. */
const MAP_FALLBACK_AIRPORT_DOT: [number, number, number] = [240, 169, 71];

/** Base dot radius in metres — identical for airports and ports. */
export const MARKER_DOT_RADIUS_M = 2200;
/** Minimum on-screen dot radius in pixels, before the user's size-slider multiplier. */
export const MARKER_DOT_MIN_PX = 4;
/** Maximum on-screen dot radius in pixels, before the user's size-slider multiplier. */
export const MARKER_DOT_MAX_PX = 8;

export interface MarkerDotRadiusProps {
  getRadius: number;
  radiusMinPixels: number;
  radiusMaxPixels: number;
}

/**
 * Resolve the ScatterplotLayer radius props for a single-point marker dot
 * (airport or port) given the user's size-slider multiplier (1 = default).
 */
export function markerDotRadiusProps(sizeScale: number): MarkerDotRadiusProps {
  return {
    getRadius: MARKER_DOT_RADIUS_M,
    radiusMinPixels: MARKER_DOT_MIN_PX * sizeScale,
    radiusMaxPixels: MARKER_DOT_MAX_PX * sizeScale,
  };
}

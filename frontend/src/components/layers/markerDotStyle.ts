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

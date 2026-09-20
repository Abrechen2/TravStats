// What changes on the trip map when the projection does — and nothing else.
//
// Three things, and they were three different kinds of mistake before they
// sat together:
//
//   - the SKY. A globe without one has a hard black edge where the horizon
//     belongs; a flat map has no horizon to paint, so it comes off again.
//   - how far a FIT may zoom. Framing: a two-airport trip reads at 9 on the
//     flat map and is silly at 14.
//   - how far a deliberate FLY-TO may zoom. Not framing — a ceiling. MapLibre
//     stops drawing a sphere above it, so a single click on a stop (zoom 11)
//     or a hotel (12) turned the globe flat while the toggle still said
//     globe, and the user had asked for neither.
//
// The fit knew about the third rule and the click handlers did not, which is
// the whole reason this is one module rather than three literals spread
// through a component.

import { STYLE_OPTIONS } from "../Globe/globeStyles";
import type { TripProjection } from "./TripMapGlobeLayers";

/**
 * The horizon that belongs to THIS basemap.
 *
 * `globeStyles.ts` pairs every basemap with its own sky, because the colours
 * only work against the tiles they were chosen for. TripMap draws the dark
 * CARTO style, so it takes the dark sky rather than inventing a fourth set.
 */
export const GLOBE_SKY = (STYLE_OPTIONS.find((s) => s.id === "dark") ?? STYLE_OPTIONS[0]).sky;

const FIT_MAX_ZOOM_MERCATOR = 9;
/** Above roughly this, MapLibre's globe flattens into a plane. */
const MAX_ZOOM_GLOBE = 3;

/** How far in a FIT may zoom — a framing choice, per projection. */
export function fitMaxZoom(projection: TripProjection): number {
  return projection === "globe" ? MAX_ZOOM_GLOBE : FIT_MAX_ZOOM_MERCATOR;
}

/**
 * How far a deliberate fly-to may zoom.
 *
 * On the flat map: as far as the caller asked. Clicking a hotel to land on
 * its street is the point, and capping that at the FIT's 9 would quietly take
 * a working gesture away. On the globe there is a hard ceiling, because past
 * it there is no globe left to be on.
 */
export function flyToZoom(projection: TripProjection, requested: number): number {
  return projection === "globe" ? Math.min(requested, MAX_ZOOM_GLOBE) : requested;
}

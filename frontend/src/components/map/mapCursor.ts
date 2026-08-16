/**
 * Cursor feedback for clickable objects on the map (issue #247).
 *
 * The airport dots, route arcs, cruise ports and lodging pins are all
 * `pickable` and all open something on click, but the pointer never said so.
 *
 * WHY THIS IS NOT deck.gl's `getCursor`: with `MapboxOverlay` the deck canvas
 * is mounted with `pointerEvents: 'none'` and the overlay merely forwards
 * synthetic moves into `deck._onPointerMove`. Nothing in `@deck.gl/mapbox`
 * reads `getCursor`, so setting it compiles, tests green, and changes nothing
 * on screen. The cursor belongs to the MapLibre canvas underneath, which is
 * what `applyHoverCursor` writes to.
 */

/**
 * The inline cursor for a hover state. Empty string means "hand it back to
 * MapLibre", which owns grab/grabbing while panning — writing `grab` ourselves
 * would fight the drag state and stick mid-pan.
 */
export function hoverCursor(picked: boolean): string {
  return picked ? "pointer" : "";
}

/** Narrow structural type so callers can pass a MapLibre or a react-map-gl ref. */
export interface CursorCanvasHost {
  getCanvas: () => { style: { cursor: string } };
}

/**
 * Write the hover cursor onto the map canvas. Tolerates a missing map: the
 * overlay renders before the map ref settles on the first frame, and a hover
 * cannot happen before there is a canvas to hover over anyway.
 */
export function applyHoverCursor(map: CursorCanvasHost | null | undefined, picked: boolean): void {
  const canvas = map?.getCanvas?.();
  if (!canvas) return;
  canvas.style.cursor = hoverCursor(picked);
}

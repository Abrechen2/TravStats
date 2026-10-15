import { useControl, useMap } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { applyHoverCursor } from "../map/mapCursor";
import type { createMarkerTooltip } from "../map/markerTooltip";

/**
 * The deck.gl overlay, mounted the way the projection needs it.
 *
 * `interleaved` shares MapLibre's WebGL context so deck.gl uses MapLibre's
 * own projection matrices. Under the globe that is not an optimisation: an
 * overlay with its own context keeps mercator matrices, and the data detaches
 * into a flat strip floating beside the sphere. It stays OFF on the flat map,
 * where the overlay draws above the basemap and interleaving would only give
 * MapLibre's own layers a chance to paint over the trip.
 *
 * No `position`, and that part is cosmetic rather than load-bearing — this
 * comment used to claim otherwise. Measured in `@deck.gl/mapbox`:
 * `MapboxOverlay.getDefaultPosition()` returns `"top-left"`, and MapLibre's
 * `addControl` falls back to it when no position is given, so passing
 * `{ position: "top-left" }` and passing nothing are the same call. It is
 * omitted because the overlay is a render pipeline rather than a corner
 * widget and saying so is clearer, NOT because passing it broke anything.
 * The four sibling overlays still pass it, correctly.
 *
 * The caller REMOUNTS this control (a `key` on the projection) rather than
 * updating it, because the constructor — which runs inside `useControl`, i.e.
 * before any projection change lands — is where deck.gl decides which shaders
 * to compile. An overlay built in mercator never re-detects globe.
 */
export function DeckGLOverlay({
  layers,
  onClick,
  getTooltip,
  interleaved,
}: {
  layers: Layer[];
  onClick: (info: PickingInfo) => void;
  getTooltip: ReturnType<typeof createMarkerTooltip>;
  interleaved: boolean;
}): null {
  const { current: map } = useMap();
  // Issue #247. See map/mapCursor.ts for why this cannot be deck.gl's
  // `getCursor`: the deck canvas has no pointer events, MapLibre owns the
  // cursor.
  const handleHover = (info: PickingInfo): void => {
    applyHoverCursor(map, Boolean(info.object));
  };
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 8,
        interleaved,
        getTooltip,
        onHover: handleHover,
      })
  );
  overlay.setProps({ layers, pickingRadius: 8, onClick, getTooltip, onHover: handleHover });
  return null;
}

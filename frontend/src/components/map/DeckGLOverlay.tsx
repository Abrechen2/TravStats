// The flat map's deck.gl overlay — a MapboxOverlay mounted through
// react-map-gl's `useControl`, which is the only pattern that does not
// fight MapLibre 5.x for the WebGL context (the `<DeckGL>` React component
// does). The globe has its own variant in GlobeView (interleaved, no
// tooltip); this one is the 2D map's.

import { useControl, useMap } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, LightingEffect, PickingInfo } from "@deck.gl/core";
import { applyHoverCursor } from "./mapCursor";
import type { createMarkerTooltip } from "./markerTooltip";

/** Check once whether WebGL2 is available (deck.gl requires it). */
function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return gl !== null;
  } catch {
    return false;
  }
}

export const webgl2Available = hasWebGL2();

interface DeckOverlayProps {
  layers: Layer[];
  effects: LightingEffect[];
  getTooltip: ReturnType<typeof createMarkerTooltip>;
  onHover: (info: PickingInfo) => void;
}

export function DeckGLOverlay({ layers, effects, getTooltip, onHover }: DeckOverlayProps): null {
  const { current: map } = useMap();
  // Issue #247: the pointer must say what is clickable. deck.gl's own
  // `getCursor` cannot do it here — MapboxOverlay mounts the deck canvas with
  // `pointerEvents: 'none'` and never reads that prop, so the visible cursor
  // belongs to the MapLibre canvas underneath.
  const hoverWithCursor = (info: PickingInfo): void => {
    applyHoverCursor(map, Boolean(info.object));
    onHover(info);
  };
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        effects,
        pickingRadius: 5,
        getTooltip,
        onHover: hoverWithCursor,
      }),
    { position: "top-left" }
  );
  // Push getTooltip on every render too so language switches propagate
  // — MapboxOverlay caches the constructor's getTooltip otherwise. `onHover`
  // rides along for the same reason.
  overlay.setProps({ layers, effects, pickingRadius: 5, getTooltip, onHover: hoverWithCursor });
  return null;
}

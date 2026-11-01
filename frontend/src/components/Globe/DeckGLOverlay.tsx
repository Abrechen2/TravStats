import { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";

interface DeckOverlayProps {
  layers: Layer[];
  onHover: (info: PickingInfo) => void;
  /** deck.gl rewrites the canvas cursor on every pointer event; this keeps the hand over native dots. */
  getCursor: (state: { isDragging: boolean; isHovering: boolean }) => string;
}

export function DeckGLOverlay({ layers, onHover, getCursor }: DeckOverlayProps): null {
  // `interleaved: true` shares MapLibre's WebGL context so deck.gl uses MapLibre's globe
  // projection matrices directly — without it, the overlay falls back to mercator and the
  // layers detach into a flat strip floating beside the globe whenever the camera is rotated.
  //
  // No `position` here: MapboxOverlay isn't a corner control, it's a
  // render-pipeline integration, so naming a corner for it reads as a
  // category error. It is NOT a lifecycle fix, which this comment used to
  // imply — measured in @deck.gl/mapbox: `getDefaultPosition()` returns
  // "top-left" and MapLibre's `addControl` falls back to it, so omitting the
  // option and passing `{position: "top-left"}` are the same call. The flat
  // map, the cruise map and the lodging mini-map all pass it and are fine.
  //
  // No `getTooltip` either: GlobeView renders its own rich React-state
  // tooltip via `onAirportHover` / `onPortHover` / `onArcHover` /
  // `onCruisePathHover`. Wiring `buildMarkerTooltip` here in addition
  // would stack two bubbles on the same hover (a deck.gl-rendered name
  // tooltip behind, and the React rich tooltip on top).
  //
  // Caller must gate this component until MapLibre is confirmed in
  // globe projection — see `mapReady` in GlobeView.
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 5,
        interleaved: true,
        onHover,
        getCursor,
      })
  );
  overlay.setProps({ layers, onHover, getCursor });
  return null;
}

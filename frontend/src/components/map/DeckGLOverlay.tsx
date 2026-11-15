// The deck.gl overlay of every map surface — a MapboxOverlay mounted through
// react-map-gl's `useControl`, which is the only pattern that does not
// fight MapLibre for the WebGL context (the `<DeckGL>` React component
// does). The globe and the trip map used to carry copies of this wrapper
// (forgejo#386); what made them differ is now explicit props — `interleaved`,
// `pickingRadius`, `getCursor`, `isOverNative`, `handleCursor` — so a change
// to the mount pattern lands once.
//
// The overlay is `@deck.gl/mapbox`'s MapboxOverlay on deck.gl 9.3, driving a
// MapLibre 6 map. That pairing needs a bridge, because 9.3 reads
// `map.transform` every frame and MapLibre 6 removed it — see
// `lib/maplibreTransformBridge.ts` for what it restores, why we are not on
// deck.gl 9.4's own `@deck.gl/maplibre` yet, and when to delete it.

import { useEffect, useRef } from "react";
import { useControl, useMap } from "react-map-gl/maplibre";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import type { Layer, LightingEffect, PickingInfo } from "@deck.gl/core";
import { applyHoverCursor } from "./mapCursor";
import type { createMarkerTooltip } from "./markerTooltip";

// Re-exported under its old name: the probe moved to `lib/webgl2.ts` when the
// dashboard's mode registry needed the same answer and a `types/` module
// cannot import a component. Every existing caller keeps its import.
export { webgl2Available } from "../../lib/webgl2";
import { releaseWebGL2Context } from "../../lib/webgl2";

interface DeckOverlayProps {
  layers: Layer[];
  /** Left out, deck.gl keeps its defaults (the route maps pass none). */
  effects?: LightingEffect[];
  /**
   * deck.gl's built-in tooltip. Optional since the owner's 2026-09-20 ruling:
   * the flat map draws the shared `HoverTooltip` from its own `onHover`
   * instead, because deck's tooltip can only be styled through a style object
   * and never matched the card beside it. The surfaces that still pass one
   * (`CruiseRouteMap`, `TripMap`) keep working unchanged.
   */
  getTooltip?: ReturnType<typeof createMarkerTooltip> | MapboxOverlayProps["getTooltip"];
  /** Also drives the pointer cursor; the layers-only route maps pass none. */
  onHover?: (info: PickingInfo) => void;
  /**
   * Any click deck.gl picked an object for, after the layer's own `onClick`.
   * The flat map uses it to tell its background-click handler that a layer
   * handled the click — the layers handed in by the tabs (forgejo#323) cannot
   * reach the map's guard themselves.
   */
  onClick?: (info: PickingInfo) => void;
  /**
   * Handed the overlay once it exists, so a right-click (a DOM event, not a
   * deck pick) can ask deck WHAT is under the cursor — the cruise route
   * editor names the leg the user aimed at that way. Pass a stable callback.
   */
  onReady?: (overlay: MapboxOverlay) => void;
  /**
   * Share MapLibre's WebGL context so deck.gl uses MapLibre's own projection
   * matrices. Under the globe projection that is not an optimisation: an
   * overlay with its own context keeps mercator matrices and the data detaches
   * into a flat strip beside the sphere. Off on the flat map, where the overlay
   * draws above the basemap and interleaving would only let MapLibre's layers
   * paint over it. deck.gl reads this in the constructor and nowhere else, so
   * a caller that changes projection REMOUNTS this component (a `key`).
   */
  interleaved?: boolean;
  /** Picking tolerance in px. The trip map is fingertip-sized, the rest 5. */
  pickingRadius?: number;
  /** deck.gl's own cursor callback; the globe keeps the hand over its native dots with it. */
  getCursor?: (state: { isDragging: boolean; isHovering: boolean }) => string;
  /**
   * True when a native MapLibre feature lies under the screen point. It wins
   * the pointer over a deck.gl object beneath it: both clicks would otherwise
   * fire and fight over the card and the camera, and the hand stays on.
   */
  isOverNative?: (x: number, y: number) => boolean;
  /**
   * Whether this overlay sets the pointer cursor itself (Issue #247). Defaults
   * to "when an `onHover` was passed"; the trip map has no `onHover` but wants
   * the hand, the globe has one and owns its cursor through `getCursor`.
   */
  handleCursor?: boolean;
}

const DEFAULT_PICKING_RADIUS = 5;

export function DeckGLOverlay({
  layers,
  effects,
  getTooltip,
  onHover,
  onClick,
  onReady,
  interleaved,
  pickingRadius = DEFAULT_PICKING_RADIUS,
  getCursor,
  isOverNative,
  handleCursor,
}: DeckOverlayProps): null {
  const { current: map } = useMap();
  // Issue #247: the pointer must say what is clickable. deck.gl's own
  // `getCursor` cannot do it here — MapboxOverlay mounts the deck canvas with
  // `pointerEvents: 'none'` and never reads that prop, so the visible cursor
  // belongs to the MapLibre canvas underneath.
  const overNative = (info: PickingInfo): boolean =>
    info.x != null && Boolean(isOverNative?.(info.x, info.y));
  const hoverHandler =
    (handleCursor ?? Boolean(onHover))
      ? (info: PickingInfo): void => {
          applyHoverCursor(map, Boolean(info.object) || overNative(info));
          onHover?.(info);
        }
      : onHover;
  const clickHandler =
    onClick && isOverNative
      ? (info: PickingInfo): void => {
          if (!overNative(info)) onClick(info);
        }
      : onClick;
  // Only the props the caller gave: an explicit `undefined` would overwrite a
  // deck.gl default that a layers-only overlay never touched.
  const overlayProps = {
    layers,
    pickingRadius,
    ...(interleaved !== undefined ? { interleaved } : {}),
    ...(effects ? { effects } : {}),
    ...(getTooltip ? { getTooltip } : {}),
    ...(getCursor ? { getCursor } : {}),
    ...(hoverHandler ? { onHover: hoverHandler } : {}),
    ...(clickHandler ? { onClick: clickHandler } : {}),
  };
  // A standalone (non-interleaved) overlay owns a canvas and a WebGL context of
  // its own, and deck.gl does not release it on finalize. Remember the canvas —
  // deck creates it after the control is added, so it is looked up on every
  // render rather than once — and give the context back once the control is
  // gone. Neither the add nor the remove callback can do the looking: the map
  // may finalize the overlay before this component's cleanup runs.
  const deckCanvas = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const overlay = useControl<MapboxOverlay>(
    () => {
      overlayRef.current = new MapboxOverlay(overlayProps);
      return overlayRef.current;
    },
    () => {
      const canvas = deckCanvas.current;
      deckCanvas.current = null;
      // After the control's own removal, which runs right behind this callback.
      queueMicrotask(() => releaseWebGL2Context(canvas));
    },
    { position: "top-left" }
  );
  useEffect(() => {
    // `?.`: the lightweight overlay doubles in the map tests have no canvas to give.
    if (!interleaved) deckCanvas.current = overlay.getCanvas?.() ?? deckCanvas.current;
  });
  // Push the props on every render too so language switches propagate
  // — MapboxOverlay caches the constructor's getTooltip otherwise. `onHover`
  // rides along for the same reason.
  overlay.setProps(overlayProps);
  useEffect(() => {
    onReady?.(overlay);
  }, [overlay, onReady]);
  return null;
}

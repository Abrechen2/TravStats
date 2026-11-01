// Mounts the globe's native layers on the MapLibre map and wires their pointer
// events (forgejo#331): hover tooltip, hand cursor, hover highlight and the
// click that pins a card. This is the part deck.gl's picking used to do.

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { PickingInfo } from "@deck.gl/core";
import type { Layer } from "@deck.gl/core";
import type { GlobePinned } from "../globeLayerTypes";
import { NativeBuildCache, buildNativeGlobe, type NativeGlobeInput } from "./nativeGlobeLayers";
import {
  createSyncState,
  nativeLayersMissing,
  removeNativeGlobe,
  syncNativeGlobe,
} from "./nativeGlobeMap";
import {
  dispatchNativeHover,
  pinnedFromHit,
  resolveNativeHit,
  syntheticInfo,
  type NativeHit,
  type NativeHoverHandlers,
} from "./nativeGlobeHits";

/** Pick radius in px — deck.gl's picking used 5, and a 1 px line is hard to land on. */
const HIT_RADIUS_PX = 5;

export interface NativeGlobeApi {
  /** Caller layers that stayed on deck.gl. */
  remainingExtras: Layer[];
  /** Whether a native feature lies under this screen point (deck.gl arcs defer to it). */
  isOverNative: (x: number, y: number) => boolean;
}

interface Options {
  mapRef: RefObject<MapRef | null>;
  mapReady: boolean;
  input: NativeGlobeInput;
  hover: NativeHoverHandlers;
  /** Hide the tooltip. */
  hideTooltip: () => void;
  setPinned: (pinned: GlobePinned | null) => void;
  /** Report whether the pointer is over a native feature (drives the hand cursor). */
  onOverChange: (over: boolean) => void;
}

export function useNativeGlobe(opts: Options): NativeGlobeApi {
  const { mapRef, mapReady, input, hover, hideTooltip, setPinned, onOverChange } = opts;
  const cache = useRef(new NativeBuildCache());
  const syncState = useRef(createSyncState());

  // Every field is a dependency: the builder is pure, and its cache keeps the
  // unchanged sources from being rebuilt.
  const spec = useMemo(() => buildNativeGlobe(input, cache.current), Object.values(input));
  const specRef = useRef(spec);
  specRef.current = spec;
  const live = useRef({ hover, hideTooltip, setPinned, onOverChange });
  live.current = { hover, hideTooltip, setPinned, onOverChange };

  const getMap = useCallback((): MapLibreMap | undefined => mapRef.current?.getMap(), [mapRef]);

  const hitAt = useCallback(
    (
      map: MapLibreMap,
      x: number,
      y: number
    ): { hit: NativeHit; id: number | string | undefined; source: string } | null => {
      const { hitOrder, targets } = specRef.current;
      const layers = hitOrder.filter((id) => map.getLayer(id));
      if (layers.length === 0) return null;
      const features = map.queryRenderedFeatures(
        [
          [x - HIT_RADIUS_PX, y - HIT_RADIUS_PX],
          [x + HIT_RADIUS_PX, y + HIT_RADIUS_PX],
        ],
        { layers }
      );
      let best: (typeof features)[number] | null = null;
      let bestRank = Infinity;
      for (const f of features) {
        const rank = hitOrder.indexOf(f.layer.id);
        if (rank >= 0 && rank < bestRank) {
          best = f;
          bestRank = rank;
        }
      }
      if (!best) return null;
      const hit = resolveNativeHit(targets, best.layer.id, best.properties?.i);
      return hit ? { hit, id: best.id, source: best.source } : null;
    },
    []
  );

  // Put the layers on the map, and put them back after a basemap swap eats them.
  useEffect(() => {
    if (!mapReady) return;
    const map = getMap();
    if (map) syncNativeGlobe(map, spec, syncState.current);
  }, [mapReady, spec, getMap]);
  useEffect(() => {
    if (!mapReady) return;
    const map = getMap();
    if (!map) return;
    let busy = false;
    const restore = (): void => {
      if (busy || !nativeLayersMissing(map, specRef.current)) return;
      busy = true;
      try {
        syncState.current.signature.clear();
        syncState.current.data.clear();
        syncNativeGlobe(map, specRef.current, syncState.current);
      } finally {
        busy = false;
      }
    };
    map.on("style.load", restore);
    map.on("styledata", restore);
    const state = syncState.current;
    return () => {
      map.off("style.load", restore);
      map.off("styledata", restore);
      removeNativeGlobe(map, state);
    };
  }, [mapReady, getMap]);

  // Pointer events.
  useEffect(() => {
    if (!mapReady) return;
    const map = getMap();
    if (!map) return;
    let hovered: { source: string; id: number | string } | null = null;
    let showing = false;
    const clearHighlight = (): void => {
      if (!hovered) return;
      try {
        map.removeFeatureState({ source: hovered.source, id: hovered.id });
      } catch {
        // The source was replaced under us; its states went with it.
      }
      hovered = null;
    };
    const onMove = (e: MapMouseEvent): void => {
      const found = hitAt(map, e.point.x, e.point.y);
      if (!found) {
        clearHighlight();
        live.current.onOverChange(false);
        if (showing) {
          showing = false;
          live.current.hideTooltip();
        }
        return;
      }
      live.current.onOverChange(true);
      showing = true;
      if (
        found.id !== undefined &&
        (!hovered || hovered.id !== found.id || hovered.source !== found.source)
      ) {
        clearHighlight();
        hovered = { source: found.source, id: found.id };
        map.setFeatureState(hovered, { hover: true });
      }
      dispatchNativeHover(found.hit, e.point.x, e.point.y, live.current.hover);
    };
    const onLeave = (): void => {
      clearHighlight();
      live.current.onOverChange(false);
      if (showing) {
        showing = false;
        live.current.hideTooltip();
      }
    };
    const onClick = (e: MapMouseEvent): void => {
      const found = hitAt(map, e.point.x, e.point.y);
      if (!found) return;
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const pinned = pinnedFromHit(found.hit, lngLat);
      if (pinned) {
        live.current.setPinned(pinned);
        return;
      }
      const own = found.hit.target.extra?.layer.props.onClick as
        ((info: PickingInfo) => void) | undefined;
      own?.(syntheticInfo(found.hit, e.point.x, e.point.y, lngLat));
    };
    map.on("mousemove", onMove);
    map.on("click", onClick);
    map.getCanvas().addEventListener("mouseleave", onLeave);
    const canvas = map.getCanvas();
    return () => {
      map.off("mousemove", onMove);
      map.off("click", onClick);
      canvas.removeEventListener("mouseleave", onLeave);
      clearHighlight();
    };
  }, [mapReady, getMap, hitAt, spec]);

  const isOverNative = useCallback(
    (x: number, y: number): boolean => {
      const map = getMap();
      return Boolean(map && hitAt(map, x, y));
    },
    [getMap, hitAt]
  );

  return { remainingExtras: spec.remainingExtras, isOverNative };
}

/**
 * Two sources can want the hand cursor at once — deck.gl's picking (arcs) and
 * the native layers. The cursor is the OR of them, written straight onto the
 * canvas (a state flip on every mouse move would re-render the globe).
 */
export function createCursorMux(getCanvas: () => HTMLCanvasElement | undefined): {
  set: (source: "deck" | "native", over: boolean) => void;
  /** Whether either source wants the hand — for deck.gl's own `getCursor`, which rewrites the canvas cursor on every pointer event. */
  isOver: () => boolean;
} {
  const over = { deck: false, native: false };
  let shown = false;
  return {
    isOver: () => over.deck || over.native,
    set(source, value) {
      over[source] = value;
      const next = over.deck || over.native;
      if (next === shown) return;
      shown = next;
      const canvas = getCanvas();
      if (canvas) canvas.style.cursor = next ? "pointer" : "";
    },
  };
}

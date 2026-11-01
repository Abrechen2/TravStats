import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { MapPinned } from "./cards/pinnedTypes";

interface Args {
  mapRef: RefObject<MapRef | null>;
  pinned: MapPinned | null;
  setPinnedPos: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setZoom: Dispatch<SetStateAction<number>>;
}

/**
 * Keeps the pinned card's screen position and the integer zoom in step with
 * the flat map's camera, throttled to one animation frame. Lifted out of
 * `DeckGLMap.tsx` unchanged (forgejo#386, REF-16).
 */
export function useFlatMapMoveTracking({
  mapRef,
  pinned,
  setPinnedPos,
  setZoom,
}: Args): () => void {
  // Reproject the card's anchor — called on every map move/zoom via onMove.
  const recomputeAllPositions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const anchor = pinnedRef.current?.anchorLngLat;
    if (!anchor) return;
    const pt = map.project(anchor);
    setPinnedPos({ x: pt.x, y: pt.y });
  }, []);

  // `recomputeAllPositions` is wired into a rAF on every move, so it must stay
  // referentially stable; reading the anchor through a ref is what keeps it so
  // without going stale.
  const pinnedRef = useRef<MapPinned | null>(null);
  useEffect(() => {
    pinnedRef.current = pinned;
    if (pinned === null) {
      setPinnedPos(null);
      return;
    }
    recomputeAllPositions();
  }, [pinned, recomputeAllPositions]);

  const moveRafRef = useRef<number | null>(null);

  const handleMapMove = useCallback(() => {
    if (moveRafRef.current !== null) return; // already scheduled
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null;
      recomputeAllPositions();
      const map = mapRef.current?.getMap();
      if (map) {
        const z = map.getZoom();
        // Snap to integer to avoid re-rendering layers on every fractional
        // zoom tick — only the threshold crossing matters for label visibility.
        const snapped = Math.round(z);
        setZoom((prev) => (prev === snapped ? prev : snapped));
      }
    });
  }, [recomputeAllPositions]);

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
      }
    };
  }, []);

  return handleMapMove;
}

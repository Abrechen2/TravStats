// Where the globe's pinned card sits on screen, and whether it should be
// drawn at all.
//
// Extracted from GlobeView when the card itself became shared map chrome
// (owner ruling 2026-09-20). It stays globe-specific on purpose: the answer
// involves the earth being in the way, which is not a question the flat map
// has.

import { useEffect, useState } from "react";
import { logger } from "../../lib/logger";
import type { MapPinned } from "../map/cards/pinnedTypes";

/** Just the map surface this needs — keeps the hook testable without MapLibre. */
export interface ProjectableMap {
  project: (lngLat: [number, number]) => { x: number; y: number };
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  on: (event: "render", handler: () => void) => void;
  off: (event: "render", handler: () => void) => void;
}

export interface PinnedScreenPos {
  x: number;
  y: number;
  /** False while the anchor is round the back of the earth. */
  visible: boolean;
}

export function usePinnedAnchor(
  pinned: MapPinned | null,
  getMap: () => ProjectableMap | null | undefined
): PinnedScreenPos | null {
  const [popupScreenPos, setPopupScreenPos] = useState<PinnedScreenPos | null>(null);

  // Mount / re-anchor / dismount the MapLibre Popup that hosts the
  // pinned detail card. `locationOccludedOpacity: 0` uses MapLibre's
  // own globe-visibility math to fade the popup when the anchor is on
  // the back of the earth — same logic as the layer occlusion shader,
  // no JS-side dot-product replay needed.
  // Subscribe to MapLibre `render` events while a card is pinned and
  // re-project the anchor lng/lat → screen pixel each frame. The
  // visibility check is the same dot-product math the EarthOcclusion
  // shader uses on the GPU, just executed once per frame in JS.
  useEffect(() => {
    const map = getMap();
    if (!map) return;

    if (!pinned) {
      setPopupScreenPos(null);
      return;
    }

    const [lng, lat] = pinned.anchorLngLat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      setPopupScreenPos(null);
      return;
    }

    const update = (): void => {
      try {
        const p = map.project([lng, lat]);
        // Visibility: anchor is on the front hemisphere if the dot
        // product between its surface-normal vector and the camera's
        // direction vector is greater than cos(horizonAngle). Same
        // approach as EarthOcclusionExtension, just JS-side.
        const center = map.getCenter();
        const zoom = map.getZoom();
        const DEG = Math.PI / 180;
        const camLng = center.lng * DEG;
        const camLat = center.lat * DEG;
        const aLng = lng * DEG;
        const aLat = lat * DEG;
        const camDir: [number, number, number] = [
          Math.cos(camLat) * Math.cos(camLng),
          Math.cos(camLat) * Math.sin(camLng),
          Math.sin(camLat),
        ];
        const anchorDir: [number, number, number] = [
          Math.cos(aLat) * Math.cos(aLng),
          Math.cos(aLat) * Math.sin(aLng),
          Math.sin(aLat),
        ];
        const dotProd =
          camDir[0] * anchorDir[0] + camDir[1] * anchorDir[1] + camDir[2] * anchorDir[2];
        // cameraDistanceFromZoom heuristic, mirrored from the shader
        const dist = 1 + 1.5 * Math.pow(2, -Math.max(0, zoom) * 0.7);
        const cosHorizon = 1.0 / Math.max(1.001, dist);
        const visible = dotProd > cosHorizon;
        setPopupScreenPos({ x: p.x, y: p.y, visible });
      } catch (err) {
        logger.error({ err, pinned }, "globe.pinned-overlay.project-failed");
        setPopupScreenPos(null);
      }
    };

    update();
    map.on("render", update);
    return () => {
      map.off("render", update);
    };
  }, [pinned, getMap]);

  return popupScreenPos;
}

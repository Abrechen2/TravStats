import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { logger } from "../../lib/logger";
import { applyMapOverlays } from "./mapOverlays";
import type { SkyConfig } from "./globeStyles";

// Auto-rotate behaviour.
const AUTO_ROTATE_DEG_PER_SEC = 4;
const AUTO_ROTATE_PAUSE_MS = 3500;
const AUTO_ROTATE_RAMP_MS = 800;

interface GlobeLifecycleOptions {
  mapRef: RefObject<MapRef | null>;
  sky: SkyConfig;
  showTerrain: boolean;
  showPlaceLabels: boolean;
  autoRotate: boolean;
}

/**
 * MapLibre-side lifecycle of the globe: engaging the globe projection + sky,
 * re-applying them after every style swap, the style-level overlays, the zoom
 * signal that drives arc altitude, and the auto-rotation loop.
 *
 * `mapReady` gates the deck.gl overlay until MapLibre is confirmed in globe
 * projection. Otherwise MapboxOverlay's constructor (run inside useControl,
 * which fires *before* onLoad) caches the initial mercator projection state
 * and never re-detects globe — the visible symptom is the deck.gl arcs and
 * dots rendering as a flat mercator strip pasted over the rotated globe.
 */
export function useGlobeMapLifecycle({
  mapRef,
  sky,
  showTerrain,
  showPlaceLabels,
  autoRotate,
}: GlobeLifecycleOptions): { mapReady: boolean; mapZoom: number; onMapLoad: () => void } {
  const [mapReady, setMapReady] = useState(false);
  // Map zoom — a level-of-detail signal for arc altitude, from MapLibre's
  // `zoom` event only (NOT `move`) so pan + rotate trigger no re-renders.
  const [mapZoom, setMapZoom] = useState<number>(0.6);

  // Mirror the overlay toggles and the sky into refs so the `style.load`
  // re-apply handler (which is created once) always reads the current values.
  const showTerrainRef = useRef(showTerrain);
  const showPlaceLabelsRef = useRef(showPlaceLabels);
  const skyRef = useRef(sky);
  useEffect(() => {
    showTerrainRef.current = showTerrain;
  }, [showTerrain]);
  useEffect(() => {
    showPlaceLabelsRef.current = showPlaceLabels;
  }, [showPlaceLabels]);
  useEffect(() => {
    skyRef.current = sky;
  }, [sky]);

  // Apply globe projection + sky on initial load. Driven by
  // react-map-gl's onLoad — the only event that fires after the map ref
  // is guaranteed populated. Re-application after style swaps is owned
  // by the next effect.
  const onMapLoad = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      map.setProjection({ type: "globe" });
    } catch (err) {
      logger.warn("GlobeView: setProjection(globe) failed", err);
    }
    try {
      map.setSky(skyRef.current);
    } catch (err) {
      logger.warn("GlobeView: setSky failed", err);
    }
    // Now that globe projection is engaged, mount the deck.gl overlay.
    // Constructor will detect globe mode and compile globe-aware shaders.
    setMapReady(true);
  }, []);

  // Track map zoom as React state — only used to drive `altitudeFactor`,
  // which controls the bow height of arc waypoints. Subscribes to the
  // `zoom` event ONLY (not `move`), so pan + rotate don't trigger
  // unrelated re-renders. rAF-throttled to coalesce wheel-tick bursts.
  // The horizon-occlusion uniforms run inside the extension's draw()
  // hook reading `viewport` directly, so React doesn't need to know
  // about the camera direction at all.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let raf = 0;
    const onZoom = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setMapZoom(map.getZoom());
      });
    };
    map.on("zoom", onZoom);
    onZoom();
    return () => {
      map.off("zoom", onZoom);
      cancelAnimationFrame(raf);
    };
  }, [mapReady, mapRef]);

  // Re-apply globe projection + sky after every style swap. MapLibre
  // resets both when replacing the style, so we listen for `style.load`
  // and reapply. Owned by its own effect with explicit cleanup so a
  // remount or strict-mode double-invoke doesn't stack listeners — every
  // stacked listener would re-apply projection on the next style load
  // and slow the swap down linearly.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const reapply = (): void => {
      try {
        map.setProjection({ type: "globe" });
      } catch (err) {
        logger.warn("GlobeView: setProjection(globe) failed", err);
      }
      try {
        map.setSky(skyRef.current);
      } catch (err) {
        logger.warn("GlobeView: setSky failed", err);
      }
      // A style swap wipes the hillshade source/layer and resets symbol
      // visibility — re-apply both from the latest toggle values.
      applyMapOverlays(map, {
        showTerrain: showTerrainRef.current,
        showPlaceLabels: showPlaceLabelsRef.current,
      });
    };
    map.on("style.load", reapply);
    return () => {
      map.off("style.load", reapply);
    };
  }, [mapReady, mapRef]);

  // Apply the style-level overlays on initial ready and whenever a
  // toggle flips (basemap swaps are handled by the `style.load` reapply
  // above). Idempotent, so the overlap with initial load is harmless.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    applyMapOverlays(map, { showTerrain, showPlaceLabels });
  }, [mapReady, mapRef, showTerrain, showPlaceLabels]);

  // Auto-rotation loop. Drives `map.jumpTo` ~60 fps with a constant
  // angular velocity (4 deg/s = one revolution / 90 s).
  //
  // Pauses on any user interaction (pointerdown / wheel / touchstart)
  // for AUTO_ROTATE_PAUSE_MS so the globe doesn't keep spinning while
  // the user is pinning a tooltip or zooming in. After the pause
  // expires, the angular velocity ramps from 0 → full over
  // AUTO_ROTATE_RAMP_MS so resume feels like a gentle acceleration
  // rather than a jerk.
  useEffect(() => {
    if (!autoRotate) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const container = map.getContainer();
    let raf = 0;
    let lastT = performance.now();
    let pausedUntil = 0;
    const onInteract = (): void => {
      pausedUntil = performance.now() + AUTO_ROTATE_PAUSE_MS;
    };
    const tick = (now: number): void => {
      const dt = now - lastT;
      lastT = now;
      const pauseRemaining = pausedUntil - now;
      if (pauseRemaining < 0) {
        const sinceResume = -pauseRemaining;
        const ramp = Math.min(1, sinceResume / AUTO_ROTATE_RAMP_MS);
        const center = map.getCenter();
        const newLng =
          ((center.lng + (dt * AUTO_ROTATE_DEG_PER_SEC * ramp) / 1000 + 540) % 360) - 180;
        map.jumpTo({ center: [newLng, center.lat] });
      }
      raf = requestAnimationFrame(tick);
    };
    container.addEventListener("pointerdown", onInteract);
    container.addEventListener("wheel", onInteract, { passive: true });
    container.addEventListener("touchstart", onInteract, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("pointerdown", onInteract);
      container.removeEventListener("wheel", onInteract);
      container.removeEventListener("touchstart", onInteract);
    };
  }, [autoRotate, mapRef]);

  return { mapReady, mapZoom, onMapLoad };
}

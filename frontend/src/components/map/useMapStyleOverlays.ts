import { useEffect, useRef, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { applyMapOverlays } from "../Globe/mapOverlays";

/**
 * Relief hillshade and basemap place names on the flat map: applied once the
 * map is loaded and whenever a toggle flips, and re-applied on every
 * `style.load` — a basemap swap reloads the style and wipes both. The toggles
 * are mirrored into refs so that once-mounted handler reads current values.
 */
export function useMapStyleOverlays(
  mapRef: RefObject<MapRef | null>,
  mapLoaded: boolean,
  showTerrain: boolean,
  showPlaceLabels: boolean
): void {
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;
    applyMapOverlays(map, { showTerrain, showPlaceLabels });
  }, [mapRef, mapLoaded, showTerrain, showPlaceLabels]);
  const showTerrainRef = useRef(showTerrain);
  const showPlaceLabelsRef = useRef(showPlaceLabels);
  useEffect(() => {
    showTerrainRef.current = showTerrain;
  }, [showTerrain]);
  useEffect(() => {
    showPlaceLabelsRef.current = showPlaceLabels;
  }, [showPlaceLabels]);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;
    const reapply = (): void =>
      applyMapOverlays(map, {
        showTerrain: showTerrainRef.current,
        showPlaceLabels: showPlaceLabelsRef.current,
      });
    map.on("style.load", reapply);
    return () => {
      map.off("style.load", reapply);
    };
  }, [mapRef, mapLoaded]);
}

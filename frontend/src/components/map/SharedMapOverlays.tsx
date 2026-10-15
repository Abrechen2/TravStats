import { useEffect, useSyncExternalStore } from "react";
import { useMap } from "react-map-gl/maplibre";
import { loadMapAppearance } from "./mapAppearance";
import { subscribeMapAppearance } from "./useBasemapStyle";
import { applyMapOverlays } from "../Globe/mapOverlays";

function snapshot(): string {
  const prefs = loadMapAppearance();
  return `${prefs.showTerrain === true}:${prefs.showPlaceLabels !== false}`;
}
/** Reapply shared overlays after style changes without touching travel layers. */
export function SharedMapOverlays(): null {
  const { current } = useMap();
  const state = useSyncExternalStore(subscribeMapAppearance, snapshot, () => "false:true");
  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const [terrain, labels] = state.split(":");
    const apply = (): void =>
      applyMapOverlays(map, {
        showTerrain: terrain === "true",
        showPlaceLabels: labels === "true",
      });
    if (map.isStyleLoaded()) apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [current, state]);
  return null;
}

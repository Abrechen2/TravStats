import { useSyncExternalStore } from "react";
import { loadMapAppearance, MAP_APPEARANCE_KEY } from "./mapAppearance";
import { FLAT_BASEMAPS, type resolveFlatStyle, type FlatStyleId } from "./basemapStyles";
import { useResilientStyle } from "./basemapFallback";
import { onLocalPrefWrite, useWebPrefsEpochStore } from "../../lib/webPrefs/prefEvents";

function snapshot(): FlatStyleId {
  const id = loadMapAppearance().styleId;
  return FLAT_BASEMAPS.some((style) => style.id === id) ? (id as FlatStyleId) : "dark";
}
export function subscribeMapAppearance(notify: () => void): () => void {
  const local = onLocalPrefWrite((key) => key === MAP_APPEARANCE_KEY, notify);
  const remote = useWebPrefsEpochStore.subscribe(notify);
  const storage = (event: StorageEvent): void => {
    if (event.key === MAP_APPEARANCE_KEY || event.key === null) notify();
  };
  window.addEventListener("storage", storage);
  return () => {
    local();
    remote();
    window.removeEventListener("storage", storage);
  };
}
/** Detail maps follow the same saved style as the dashboard and globe, and its fallback. */
export function useBasemapStyle(): ReturnType<typeof resolveFlatStyle> {
  return useResilientStyle(useSyncExternalStore(subscribeMapAppearance, snapshot, () => "dark"));
}

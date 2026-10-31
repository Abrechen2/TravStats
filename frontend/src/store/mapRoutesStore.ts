import { create } from "zustand";
import { loadMapAppearance, saveMapAppearance } from "../components/map/mapAppearance";
import { routesVisibleFromStored, type RouteDomain, type RoutesVisible } from "../lib/mapRoutes";

/**
 * The ONE place the per-domain "draw the routes" switches live at runtime.
 * The panel writes here; the maps, the tabs that build overlay lines and the
 * legends read here, so a hidden route type leaves the legend with the line
 * (same shape as `recordedFlightPathsStore`). Persisted on change only,
 * through the shared `mapAppearance` blob and with it the account sync.
 */
export function loadRoutesVisible(): RoutesVisible {
  return routesVisibleFromStored(loadMapAppearance().routesVisible);
}

interface MapRoutesState {
  visible: RoutesVisible;
  setVisible: (domain: RouteDomain, visible: boolean) => void;
}

export const useMapRoutesStore = create<MapRoutesState>((set, get) => ({
  visible: loadRoutesVisible(),
  setVisible: (domain, visible) => {
    const next = { ...get().visible, [domain]: visible };
    saveMapAppearance({ routesVisible: next });
    set({ visible: next });
  },
}));

/** Whether one domain's lines are drawn. */
export function useRoutesVisible(domain: RouteDomain): boolean {
  return useMapRoutesStore((s) => s.visible[domain]);
}

import { create } from "zustand";
import { loadMapAppearance, saveMapAppearance } from "../components/map/mapAppearance";
import {
  ALL_ROUTES_VISIBLE,
  routesVisibleFromStored,
  type RouteDomain,
  type RoutesVisible,
} from "../lib/mapRoutes";

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
  /**
   * The current dashboard mode cannot do without its routes (`routesBlockedReason`):
   * the stored switches are then ignored by every consumer, so a "hidden" that
   * was set elsewhere cannot empty a mode whose switch is disabled.
   */
  blocked: boolean;
  setBlocked: (blocked: boolean) => void;
  setVisible: (domain: RouteDomain, visible: boolean) => void;
}

export const useMapRoutesStore = create<MapRoutesState>((set, get) => ({
  visible: loadRoutesVisible(),
  blocked: false,
  setBlocked: (blocked) => set({ blocked }),
  setVisible: (domain, visible) => {
    const next = { ...get().visible, [domain]: visible };
    saveMapAppearance({ routesVisible: next });
    set({ visible: next });
  },
}));

/** What the maps, overlays and legends draw: the switches, unless the mode is blocked. */
export const effectiveRoutes = (s: MapRoutesState): RoutesVisible =>
  s.blocked ? ALL_ROUTES_VISIBLE : s.visible;

/** Whether one domain's lines are drawn. */
export function useRoutesVisible(domain: RouteDomain): boolean {
  return useMapRoutesStore((s) => effectiveRoutes(s)[domain]);
}

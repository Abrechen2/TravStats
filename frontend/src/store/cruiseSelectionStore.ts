import { create } from "zustand";
import type { Cruise } from "../types/cruise";

/**
 * Selection state for cruises on the dashboard map. Mirrors the shape of
 * `flightSelectionStore` so map layers + sidebars can subscribe with the
 * same mental model: `selectedCruiseId` drives dim/highlight in the arc
 * layer, `detailOpen` drives whether the floating detail tooltip is
 * shown near the cursor or anchored to a panel.
 *
 * Flights and cruises stay in separate stores on purpose — the dim
 * behaviours are per-domain (selecting a flight should not dim cruises
 * and vice versa), and the selection lifetimes diverge: cruise
 * selection survives a MapMode switch within the cruise tab, flights
 * reset when leaving the flight tab.
 */
interface CruiseSelectionState {
  selectedCruiseId: string | null;
  selectedCruise: Cruise | null;
  detailOpen: boolean;
  setSelection: (cruise: Cruise | null) => void;
  showDetails: (cruise: Cruise) => void;
  clearSelection: () => void;
}

export const useCruiseSelectionStore = create<CruiseSelectionState>()((set) => ({
  selectedCruiseId: null,
  selectedCruise: null,
  detailOpen: false,
  setSelection: (cruise) =>
    set({
      selectedCruise: cruise,
      selectedCruiseId: cruise?.id ?? null,
      detailOpen: false,
    }),
  showDetails: (cruise) =>
    set({
      selectedCruise: cruise,
      selectedCruiseId: cruise.id,
      detailOpen: true,
    }),
  clearSelection: () => set({ selectedCruiseId: null, selectedCruise: null, detailOpen: false }),
}));

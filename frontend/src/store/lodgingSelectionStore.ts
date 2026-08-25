import { create } from "zustand";
import type { Lodging } from "../types/lodging";

/**
 * Selection state for lodgings on the dashboard map.
 *
 * Mirrors `cruiseSelectionStore` rather than joining it: that store documents
 * why the domains keep their own state — the dim behaviour is per-domain
 * (selecting a hotel must not dim the cruises) and the selection lifetimes
 * differ per tab. One shared store would have to re-invent both distinctions
 * internally.
 *
 * Single selection on purpose. A sidebar row click means "show me this one",
 * and the flight store's multi-select exists for its trip/group path, which
 * lodgings have no equivalent of.
 */
interface LodgingSelectionState {
  selectedLodgingId: string | null;
  selectedLodging: Lodging | null;
  setSelection: (lodging: Lodging | null) => void;
  clearSelection: () => void;
}

export const useLodgingSelectionStore = create<LodgingSelectionState>()((set) => ({
  selectedLodgingId: null,
  selectedLodging: null,
  setSelection: (lodging) =>
    set({
      selectedLodging: lodging,
      selectedLodgingId: lodging?.id ?? null,
    }),
  clearSelection: () => set({ selectedLodging: null, selectedLodgingId: null }),
}));

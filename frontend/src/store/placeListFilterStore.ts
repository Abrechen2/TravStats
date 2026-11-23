import { create } from "zustand";
import { loadMapAppearance, saveMapAppearance } from "../components/map/mapAppearance";
import { selectionFromStored, type ListSelectionKey } from "../lib/mapPlaceLists";

/**
 * The place lists the dashboard map is narrowed to; empty is "Alle Orte".
 * One map choice like the colour stores: persisted in the shared
 * `mapAppearance` blob (and with it the account sync), read by the flat map,
 * the globe, the legend and the card, so they cannot disagree.
 */
interface PlaceListFilterState {
  selection: ListSelectionKey[];
  /**
   * A list is really narrowing the map right now — set by `useListedPlaces`,
   * which knows whether the stored selection still names anything. The maps,
   * the legend and the tooltip read this, never `selection.length`: a stored
   * key of a deleted list must not paint every wishlist pin grey.
   */
  viewActive: boolean;
  setViewActive: (active: boolean) => void;
  setSelection: (selection: ListSelectionKey[]) => void;
  toggle: (key: ListSelectionKey) => void;
  clear: () => void;
}

function persist(selection: ListSelectionKey[]): void {
  saveMapAppearance({ placeListSelection: selection });
}

export const usePlaceListFilterStore = create<PlaceListFilterState>((set) => ({
  selection: selectionFromStored(loadMapAppearance().placeListSelection),
  viewActive: false,
  setViewActive: (viewActive) => set({ viewActive }),
  setSelection: (selection) => {
    persist(selection);
    set({ selection });
  },
  toggle: (key) =>
    set((state) => {
      const selection = state.selection.includes(key)
        ? state.selection.filter((k) => k !== key)
        : [...state.selection, key];
      persist(selection);
      return { selection };
    }),
  clear: () => {
    persist([]);
    set({ selection: [] });
  },
}));

/** A list is chosen: unvisited members draw grey and say "noch nicht besucht". */
export const isListViewActive = (): boolean => usePlaceListFilterStore.getState().viewActive;

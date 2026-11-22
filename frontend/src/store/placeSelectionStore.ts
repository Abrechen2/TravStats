import { create } from "zustand";
import type { Place } from "../types/place";

/**
 * Selection state for places (POI) on the dashboard map.
 *
 * Same shape and same reasoning as `lodgingSelectionStore` — see the note in
 * `cruiseSelectionStore` for why the domains do not share one store.
 *
 * Unlike lodgings, a place always has coordinates (`lat`/`lon` are NOT NULL),
 * so a selected place can always be focused.
 */
interface PlaceSelectionState {
  selectedPlaceId: string | null;
  selectedPlace: Place | null;
  /** The entry of that place the selection is ABOUT (a stay, a visit), when it is one of several. */
  selectedEntryId: string | null;
  setSelection: (place: Place | null, entryId?: string) => void;
  clearSelection: () => void;
}

export const usePlaceSelectionStore = create<PlaceSelectionState>()((set) => ({
  selectedPlaceId: null,
  selectedPlace: null,
  selectedEntryId: null,
  setSelection: (place, entryId) =>
    set({
      selectedEntryId: entryId ?? null,
      selectedPlace: place,
      selectedPlaceId: place?.id ?? null,
    }),
  clearSelection: () => set({ selectedPlace: null, selectedPlaceId: null, selectedEntryId: null }),
}));

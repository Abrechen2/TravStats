import { create } from "zustand";
import type { Flight } from "../types";

interface FlightSelectionState {
  selectedIds: string[];
  selectedFlights: Flight[];
  highlightMode: "single" | "group" | null;
  setSelection: (ids: string[], flights: Flight[]) => void;
  clearSelection: () => void;
}

export const useFlightSelectionStore = create<FlightSelectionState>()((set) => ({
  selectedIds: [],
  selectedFlights: [],
  highlightMode: null,
  setSelection: (ids, flights) =>
    set({
      selectedIds: ids,
      selectedFlights: flights,
      highlightMode: ids.length === 0 ? null : ids.length === 1 ? "single" : "group",
    }),
  clearSelection: () => set({ selectedIds: [], selectedFlights: [], highlightMode: null }),
}));

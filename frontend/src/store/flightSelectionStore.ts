import { create } from "zustand";
import type { Flight } from "../types";

interface FlightSelectionState {
  selectedIds: string[];
  selectedFlights: Flight[];
  highlightMode: "single" | "group" | null;
  setSelection: (flights: Flight[]) => void;
  clearSelection: () => void;
}

export const useFlightSelectionStore = create<FlightSelectionState>()((set) => ({
  selectedIds: [],
  selectedFlights: [],
  highlightMode: null,
  setSelection: (flights) =>
    set({
      selectedFlights: flights,
      selectedIds: flights.map((f) => f.id),
      highlightMode: flights.length === 0 ? null : flights.length === 1 ? "single" : "group",
    }),
  clearSelection: () => set({ selectedIds: [], selectedFlights: [], highlightMode: null }),
}));

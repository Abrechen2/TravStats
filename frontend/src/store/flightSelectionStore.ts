import { create } from "zustand";
import type { Flight } from "../types";

type DetailMode = "route-details" | "trip-details" | null;

interface FlightSelectionState {
  selectedIds: string[];
  selectedFlights: Flight[];
  highlightMode: "single" | "group" | null;
  detailMode: DetailMode;
  setSelection: (flights: Flight[]) => void;
  showDetails: (flights: Flight[], mode: "route-details" | "trip-details") => void;
  clearSelection: () => void;
}

export const useFlightSelectionStore = create<FlightSelectionState>()((set) => ({
  selectedIds: [],
  selectedFlights: [],
  highlightMode: null,
  detailMode: null,
  setSelection: (flights) =>
    set({
      selectedFlights: flights,
      selectedIds: flights.map((f) => f.id),
      highlightMode: flights.length === 0 ? null : flights.length === 1 ? "single" : "group",
      detailMode: null,
    }),
  showDetails: (flights, mode) =>
    set({
      selectedFlights: flights,
      selectedIds: flights.map((f) => f.id),
      highlightMode: "group",
      detailMode: mode,
    }),
  clearSelection: () =>
    set({ selectedIds: [], selectedFlights: [], highlightMode: null, detailMode: null }),
}));

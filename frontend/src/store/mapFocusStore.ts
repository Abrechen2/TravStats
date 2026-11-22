import { create } from "zustand";

/**
 * Where something OUTSIDE the map (the activity list) wants the camera to go.
 *
 * A layer click moves no camera — the reader is already looking at the line —
 * and the four selection stores each move it their own way (a flight fits its
 * two airports, a hotel flies to its pin). A list row has to bring ANY
 * domain's entry into view, so it asks here and whichever map is mounted
 * (flat or globe, `map/cards/useMapFocusRequests.ts`) obeys.
 *
 * `seq` counts requests. A map remembers the count it mounted at and ignores
 * anything older, so a request made for a map that is gone cannot surface as a
 * camera move on the next one that mounts — the same device as
 * `mapCardSelectionStore`. Every call builds a new object, so asking for the
 * same place twice flies twice.
 */
export interface MapFocusTarget {
  /** One place to zoom to. */
  point?: { lat: number; lon: number } | null;
  /** A route's extent `[west, south, east, north]` to fit. Wins over `point`. */
  bbox?: [number, number, number, number] | null;
  /** Pixels the chrome covers, so the target lands in the VISIBLE part of the map. */
  leftInset?: number;
}

interface MapFocusState {
  request: MapFocusTarget | null;
  seq: number;
  focus: (target: MapFocusTarget) => void;
}

export const useMapFocusStore = create<MapFocusState>()((set) => ({
  request: null,
  seq: 0,
  focus: (target) => set((s) => ({ request: { ...target }, seq: s.seq + 1 })),
}));

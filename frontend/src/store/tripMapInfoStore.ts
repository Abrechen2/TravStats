import { create } from "zustand";
import type { DaySpan } from "../components/Trips/tripMapDays";

/** What the trip map's persistent info card shows (not the dashboard's journey cards). */
export interface TripMapInfo {
  /** Stable per entity, so a second click on the same thing re-opens rather than stacks. */
  key: string;
  kind: "lodging" | "stop" | "place" | "cruise";
  title: string;
  /** The line under the title: city, category … */
  subtitle?: string | null;
  span: DaySpan | null;
  /** The entity's own page, or null where it has none (a stop). */
  entityHref: string | null;
  /** The entry's place in the trip's timeline (`?tab=timeline#…`), or null off a trip page. */
  timelineHref: string | null;
}

interface TripMapInfoState {
  info: TripMapInfo | null;
  open: (info: TripMapInfo) => void;
  close: () => void;
}

/**
 * One card per trip map, held outside the map component because the places
 * layer is built a level above it and has to open the same card a hotel does.
 */
export const useTripMapInfoStore = create<TripMapInfoState>((set) => ({
  info: null,
  open: (info) => set({ info }),
  close: () => set({ info: null }),
}));

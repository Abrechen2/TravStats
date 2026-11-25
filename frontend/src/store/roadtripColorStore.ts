import { create } from "zustand";
import { loadMapAppearance, saveMapAppearance } from "../components/map/mapAppearance";
import { roadtripColorModeFromStored, type RoadtripColorMode } from "../lib/roadtripColor";

/**
 * The ONE place the roadtrip colour mode lives at runtime (GitHub #408): the
 * dashboard lines, the trip map's lines, the map panel and the legend all read
 * it here, so a view can never pick the mode implicitly. Persisted through the
 * shared `mapAppearance` blob, on change only.
 */
interface RoadtripColorState {
  mode: RoadtripColorMode;
  setMode: (mode: RoadtripColorMode) => void;
}

export const useRoadtripColorStore = create<RoadtripColorState>((set) => ({
  mode: roadtripColorModeFromStored(loadMapAppearance().roadtripColorMode),
  setMode: (mode) => {
    saveMapAppearance({ roadtripColorMode: mode });
    set({ mode });
  },
}));

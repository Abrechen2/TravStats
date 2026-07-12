import { create } from "zustand";
import { loadFlightColorConfig, saveMapAppearance } from "../components/map/mapAppearance";
import type { Rgb } from "../lib/cruiseColor";
import type { FlightColorConfig, FlightColorMode, FlightColorSlot } from "../lib/flightColor";

/**
 * The ONE place the flight-colour mode + colours live at runtime.
 *
 * The flat map (`DeckGLMap`), the globe (`GlobeView`), both control panels and
 * the dashboard legend (`Dashboard/tabs/AllTab`) all subscribe here. Before
 * this store, the two maps each kept a private copy of the persisted blob, so
 * a change in one didn't reach the other within a session, and the legend read
 * nothing at all (it hardcoded its colour strings) — the reported "the legend
 * doesn't follow the colour" bug. One store, one truth.
 *
 * Persistence goes through the existing `mapAppearance` localStorage blob so
 * the flight colours live next to the rest of the map appearance, exactly like
 * every other appearance field.
 */
interface FlightColorState {
  config: FlightColorConfig;
  setMode: (mode: FlightColorMode) => void;
  setColor: (slot: FlightColorSlot, color: Rgb) => void;
}

function persist(config: FlightColorConfig): void {
  saveMapAppearance({ flightColorMode: config.mode, flightColors: config.colors });
}

export const useFlightColorStore = create<FlightColorState>((set) => ({
  config: loadFlightColorConfig(),
  setMode: (mode) =>
    set((state) => {
      const config: FlightColorConfig = { ...state.config, mode };
      persist(config);
      return { config };
    }),
  setColor: (slot, color) =>
    set((state) => {
      const config: FlightColorConfig = {
        ...state.config,
        colors: { ...state.config.colors, [slot]: color },
      };
      persist(config);
      return { config };
    }),
}));

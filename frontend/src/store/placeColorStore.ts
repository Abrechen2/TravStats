import { create } from "zustand";
import { loadPlaceColorConfig, saveMapAppearance } from "../components/map/mapAppearance";
import type { PlaceColorConfig, PlaceColorMode, PlaceColorSlot } from "../lib/placeColor";
import type { Rgb } from "../lib/cruiseColor";

/**
 * The ONE place the place-pin colour mode + colours live at runtime — the
 * fourth domain to get one, deliberately the same shape as the flight, cruise
 * and lodging stores rather than a fourth invention.
 *
 * The pin layer and the legend both subscribe here, which is the invariant
 * CLAUDE.md spells out: a layer or a legend that resolves a colour privately
 * is exactly the drift 2.4.0 removed.
 *
 * Persistence goes through the shared `mapAppearance` localStorage blob, next
 * to the other three domains' colours.
 */
interface PlaceColorState {
  config: PlaceColorConfig;
  setMode: (mode: PlaceColorMode) => void;
  setColor: (slot: PlaceColorSlot, color: Rgb) => void;
}

function persist(config: PlaceColorConfig): void {
  saveMapAppearance({ placeColorMode: config.mode, placeColors: config.colors });
}

export const usePlaceColorStore = create<PlaceColorState>((set) => ({
  config: loadPlaceColorConfig(),
  setMode: (mode) =>
    set((state) => {
      const config: PlaceColorConfig = { ...state.config, mode };
      persist(config);
      return { config };
    }),
  // Slots stay independent: a colour picked for "wishlist" must survive a trip
  // through "solid" and back.
  setColor: (slot, color) =>
    set((state) => {
      const config: PlaceColorConfig = {
        ...state.config,
        colors: { ...state.config.colors, [slot]: color },
      };
      persist(config);
      return { config };
    }),
}));

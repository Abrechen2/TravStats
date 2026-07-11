import { create } from "zustand";
import { loadCruiseColorConfig, saveMapAppearance } from "../components/map/mapAppearance";
import type { CruiseColorConfig, CruiseColorMode, CruiseColorSlot, Rgb } from "../lib/cruiseColor";

/**
 * The ONE place the cruise-colour mode + colours live at runtime.
 *
 * The flat map (`DeckGLMap`), the globe (`GlobeView`), both control panels and
 * the dashboard legend (`Dashboard/tabs/AllTab`) all subscribe here. Before
 * this store the MODE was a hardcoded prop per dashboard tab and the colour was
 * a private copy of the persisted blob in each map — so the user could not
 * choose, and the legend (which read nothing at all) could not follow. One
 * store, one truth.
 *
 * Persistence goes through the existing `mapAppearance` localStorage blob, so
 * the cruise colours live next to the rest of the map appearance, exactly like
 * the flight colours.
 */
interface CruiseColorState {
  config: CruiseColorConfig;
  setMode: (mode: CruiseColorMode) => void;
  setColor: (slot: CruiseColorSlot, color: Rgb) => void;
}

function persist(config: CruiseColorConfig): void {
  saveMapAppearance({ cruiseColorMode: config.mode, cruiseColors: config.colors });
}

export const useCruiseColorStore = create<CruiseColorState>((set) => ({
  config: loadCruiseColorConfig(),
  setMode: (mode) =>
    set((state) => {
      const config: CruiseColorConfig = { ...state.config, mode };
      persist(config);
      return { config };
    }),
  setColor: (slot, color) =>
    set((state) => {
      const config: CruiseColorConfig = {
        ...state.config,
        colors: { ...state.config.colors, [slot]: color },
      };
      persist(config);
      return { config };
    }),
}));

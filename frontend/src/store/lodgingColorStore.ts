import { create } from "zustand";
import { loadLodgingColorConfig, saveMapAppearance } from "../components/map/mapAppearance";
import type {
  LodgingColorConfig,
  LodgingColorMode,
  LodgingColorSlot,
} from "../lib/lodgingColor";
import type { Rgb } from "../lib/cruiseColor";

/**
 * The ONE place the lodging-pin colour mode + colours live at runtime — the
 * third domain to get one, and deliberately the same shape as the flight and
 * cruise stores rather than a fourth invention.
 *
 * The pin layer and the control panel both subscribe here. Before this, a pin's
 * colour was a constant inside `lodgingPinsLayer`, so the user could not choose
 * and nothing could show a legend for a choice that did not exist.
 *
 * Persistence goes through the shared `mapAppearance` localStorage blob, next
 * to the flight and cruise colours.
 */
interface LodgingColorState {
  config: LodgingColorConfig;
  setMode: (mode: LodgingColorMode) => void;
  setColor: (slot: LodgingColorSlot, color: Rgb) => void;
}

function persist(config: LodgingColorConfig): void {
  saveMapAppearance({ lodgingColorMode: config.mode, lodgingColors: config.colors });
}

export const useLodgingColorStore = create<LodgingColorState>((set) => ({
  config: loadLodgingColorConfig(),
  setMode: (mode) =>
    set((state) => {
      const config: LodgingColorConfig = { ...state.config, mode };
      persist(config);
      return { config };
    }),
  // Slots stay independent: picking a colour for "campsite" must not disturb
  // the one chosen for "rated", so switching modes never loses a choice.
  setColor: (slot, color) =>
    set((state) => {
      const config: LodgingColorConfig = {
        ...state.config,
        colors: { ...state.config.colors, [slot]: color },
      };
      persist(config);
      return { config };
    }),
}));

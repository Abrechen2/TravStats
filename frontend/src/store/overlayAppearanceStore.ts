import { create } from "zustand";
import { loadOverlayAppearance, saveMapAppearance } from "../components/map/mapAppearance";
import type { OverlayAppearance } from "../lib/overlayAppearance";

/**
 * The ONE place the tour, roadtrip, rail and rental line widths and marker
 * sizes live at runtime (forgejo#198). The map control panel writes here, and
 * the dashboard tabs that build those layers read here — see
 * `lib/overlayAppearance.ts` for why a store, not props.
 *
 * Persisted on change only, never on load, through the shared `mapAppearance`
 * blob's merge-write: writing the defaults on mount would bake them into every
 * user's storage and make a later change of default a no-op for them.
 */
interface OverlayAppearanceState {
  appearance: OverlayAppearance;
  setValue: <K extends keyof OverlayAppearance>(key: K, value: OverlayAppearance[K]) => void;
}

export const useOverlayAppearanceStore = create<OverlayAppearanceState>((set) => ({
  appearance: loadOverlayAppearance(),
  setValue: (key, value) =>
    set((state) => {
      const patch = { [key]: value } as Pick<OverlayAppearance, typeof key>;
      saveMapAppearance(patch);
      return { appearance: { ...state.appearance, ...patch } };
    }),
}));

/** The resolved appearance, for a layer builder's caller. */
export function useOverlayAppearance(): OverlayAppearance {
  return useOverlayAppearanceStore((s) => s.appearance);
}

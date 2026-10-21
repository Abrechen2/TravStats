import { create } from "zustand";
import type { LabelsMode } from "../components/map/labelPriority";
import { loadMapAppearance, saveMapAppearance } from "../components/map/mapAppearance";

/**
 * The ONE place the map's label reveal (off / key markers / all) lives at
 * runtime.
 *
 * It used to be component state in `DeckGLMap` and `GlobeView`, which was
 * enough while every labelled layer was built inside them. The station labels
 * of rail, bus and ferry (forgejo#320) are built by the dashboard tabs and
 * handed in as `extraLayers` — the panel that sets the mode lives inside the
 * map, the layers that read it are built outside. A store both read is the
 * only shape where the switch and those labels cannot disagree, the same
 * answer `overlayAppearanceStore` gives for line widths.
 *
 * Persisted on change only, through the shared `mapAppearance` blob.
 */
const MODES: readonly LabelsMode[] = ["off", "important", "all"];

/** The stored mode; anything else in the blob (external data) is the default. */
export function loadLabelsMode(): LabelsMode {
  const stored: unknown = loadMapAppearance().labelsMode;
  return MODES.includes(stored as LabelsMode) ? (stored as LabelsMode) : "important";
}

interface MapLabelsModeState {
  mode: LabelsMode;
  setMode: (mode: LabelsMode) => void;
}

export const useMapLabelsModeStore = create<MapLabelsModeState>((set) => ({
  mode: loadLabelsMode(),
  setMode: (mode) => {
    saveMapAppearance({ labelsMode: mode });
    set({ mode });
  },
}));

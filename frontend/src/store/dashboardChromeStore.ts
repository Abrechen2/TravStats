import { create } from "zustand";

export type AddableDomain = "flight" | "cruise" | "poi";

/**
 * Thin bridge between the in-map control panel (which now hosts the
 * "+ hinzufügen" action) and DashboardLayout (which owns the actual
 * add-modals). The panel is rendered deep inside the map tree, several
 * layers below the layout that knows how to open a flight/cruise form —
 * rather than prop-drill an `onAdd` callback through MapContainer3D →
 * GlobeView/DeckGLMap → panel, the panel bumps `addTick` here and the
 * layout reacts to it.
 *
 * `addTick` increments on every request so DashboardLayout can react even
 * when the same domain is added twice in a row (a value-change effect on a
 * plain domain string would miss the repeat).
 */
interface DashboardChromeState {
  addTick: number;
  addDomain: AddableDomain | null;
  requestAdd: (domain?: AddableDomain) => void;
}

export const useDashboardChromeStore = create<DashboardChromeState>((set) => ({
  addTick: 0,
  addDomain: null,
  requestAdd: (domain) => set((s) => ({ addTick: s.addTick + 1, addDomain: domain ?? null })),
}));

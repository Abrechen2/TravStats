import { create } from "zustand";

export interface QuickVisitTarget {
  id: string;
  name: string;
}

interface QuickVisitState {
  /** The place a visit is being recorded for, or null. */
  target: QuickVisitTarget | null;
  /** How many hosts are mounted to show the dialog. */
  hosts: number;
  open: (target: QuickVisitTarget) => void;
  close: () => void;
  /** Mount a host; the returned function unmounts it. */
  register: () => () => void;
}

/**
 * "Besuch erfassen" from a pin's card on the map (forgejo#231).
 *
 * The card sits five components below the page that can reload the map
 * (MapContainer3D → DeckGLMap/GlobeView → PinnedCard → PlaceBody), and both
 * maps render it. A store says "record a visit here" without threading a
 * callback through all of them; a `QuickVisitHost` on the page shows the
 * dialog. The card offers the action only while a host is mounted, so a map
 * on a page without one never shows a button that does nothing.
 */
export const useQuickVisitStore = create<QuickVisitState>((set) => ({
  target: null,
  hosts: 0,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
  register: () => {
    set((s) => ({ hosts: s.hosts + 1 }));
    // An open dialog closes only with the LAST host — another host going away
    // must not drop a visit someone is typing (review M4).
    return () =>
      set((s) => {
        const hosts = Math.max(0, s.hosts - 1);
        return hosts === 0 ? { hosts, target: null } : { hosts };
      });
  },
}));

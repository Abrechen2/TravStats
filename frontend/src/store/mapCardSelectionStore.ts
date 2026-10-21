import { create } from "zustand";
import type { MapPinned } from "../components/map/cards/pinnedTypes";
import type { DomainKey } from "../shared/domains";

/**
 * A card a map LAYER asked for (forgejo#323).
 *
 * The flight and cruise layers are built inside the map component, which owns
 * the card state and hands them its setter. The rail, bus, ferry, rental and
 * tour layers are built by the dashboard tabs and the trip map and arrive as
 * `extraLayers`, far from that state — on the flat map AND the globe. A layer
 * click writes here, and whichever map is mounted shows the card through
 * `useMapSelectionCards`, so neither renderer (both on the file-size ratchet)
 * needs a prop per domain.
 *
 * `select` always stores the object it is given, and every click builds a new
 * one, so clicking the same line again after closing the card reopens it.
 *
 * `seq` counts selections. A map remembers the count it mounted at and ignores
 * anything older, so a click on a map WITHOUT a card host (a cruise's own
 * itinerary map draws the same port layer) cannot surface as a card on the
 * next map that mounts.
 *
 * `withheld` names the domains whose layers the mounted dashboard is NOT
 * drawing although the user has them on — unticked in the "Alle" map's domain
 * filter. Only the tab knows that filter; the card hook treats a withheld
 * domain as switched off, so its open card closes with its layer (Codex
 * review). The publisher takes it back when it unmounts.
 */
interface MapCardSelectionState {
  pinned: MapPinned | null;
  seq: number;
  withheld: readonly DomainKey[];
  select: (pinned: MapPinned) => void;
  clear: () => void;
  setWithheld: (domains: readonly DomainKey[]) => void;
}

export const useMapCardSelectionStore = create<MapCardSelectionState>()((set) => ({
  pinned: null,
  seq: 0,
  withheld: [],
  select: (pinned) => set((s) => ({ pinned, seq: s.seq + 1 })),
  clear: () => set({ pinned: null }),
  setWithheld: (domains) => set({ withheld: domains }),
}));

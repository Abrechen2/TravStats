import { create } from "zustand";

/**
 * A revision per trip, bumped when its sharing changed (spec 2026-10-16, D10):
 * the head's "Teilen" menu and the overview's "Reisende" section load their
 * own state, and this is how one tells the other — without threading a prop
 * through `TripDetailPage.tsx`, which the file-size ratchet keeps frozen.
 * Never persisted: it means "reload", nothing more.
 */
interface TripSharingState {
  revision: Record<string, number>;
  bump: (tripId: string) => void;
}

export const useTripSharingStore = create<TripSharingState>((set) => ({
  revision: {},
  bump: (tripId) =>
    set((state) => ({
      revision: { ...state.revision, [tripId]: (state.revision[tripId] ?? 0) + 1 },
    })),
}));

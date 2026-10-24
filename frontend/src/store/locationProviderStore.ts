import { create } from "zustand";
import {
  locationProviderApi,
  type LocationProviderKind,
  type LocationProviderSettings,
} from "../lib/api/locationProvider";

/**
 * The account's location provider as the web knows it (TravTrack plan S5).
 *
 * One store because three cards on one page change or depend on it: the
 * "Standortquelle" section shows and switches it, the Dawarich connection card
 * changes which choices are open (a saved connection opens Dawarich, a removed
 * key closes it) and its hint switches the provider itself. Each holding its
 * own copy left the section stale: Dawarich stayed disabled after a connect,
 * "Keine" stayed selected after the hint switched, and a click on "Keine" then
 * did nothing because it looked like no change (Codex review, 2026-10-24).
 *
 * Not persisted: the server holds the truth, re-learned per page.
 */
interface LocationProviderState {
  settings: LocationProviderSettings | null;
  /** The last load failed and nothing is known yet. */
  loadFailed: boolean;
  /** Ask the server again. Resolves to what it said, or null when it could not be asked. */
  refresh: () => Promise<LocationProviderSettings | null>;
  /** Switch; throws the request's error, so the caller can show its mapped copy. */
  choose: (kind: LocationProviderKind) => Promise<LocationProviderSettings>;
  reset: () => void;
}

export const useLocationProviderStore = create<LocationProviderState>((set) => ({
  settings: null,
  loadFailed: false,
  refresh: async () => {
    try {
      const settings = await locationProviderApi.get();
      set({ settings, loadFailed: false });
      return settings;
    } catch {
      set({ loadFailed: true });
      return null;
    }
  },
  choose: async (kind) => {
    const settings = await locationProviderApi.set(kind);
    set({ settings, loadFailed: false });
    return settings;
  },
  reset: () => set({ settings: null, loadFailed: false }),
}));

import { create } from "zustand";
import {
  locationProviderApi,
  type LocationProviderKind,
  type LocationProviderSettings,
} from "../lib/api/locationProvider";
import { useAuthStore } from "./authStore";

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
 * Two more rules make a module-level store safe (Codex, final pass):
 * - **Newest request wins.** Every GET and PUT takes a ticket; an answer
 *   whose ticket is no longer the newest is dropped, so a slow GET cannot
 *   undo a switch that landed after it was sent.
 * - **One account's answer never reaches another.** Logout and login are SPA
 *   navigations, so a change of the signed-in user resets the store and voids
 *   every ticket in flight — the next account sees nothing of the last one's
 *   provider, even when its own load fails.
 *
 * Not persisted: the server holds the truth, re-learned per page.
 */
interface LocationProviderState {
  settings: LocationProviderSettings | null;
  /** The last load failed and nothing is known yet. */
  loadFailed: boolean;
  /**
   * Ask the server again. Resolves to what it said, or null when it could not
   * be asked or a newer request (or another account) superseded the answer.
   */
  refresh: () => Promise<LocationProviderSettings | null>;
  /** Switch; throws the request's error, so the caller can show its mapped copy. */
  choose: (kind: LocationProviderKind) => Promise<LocationProviderSettings>;
  reset: () => void;
}

let newestTicket = 0;
const signedIn = (): string | null => useAuthStore.getState().user?.id ?? null;

/** A ticket for one request: still current only while it is the newest, for the same user. */
function ticket(): () => boolean {
  const mine = ++newestTicket;
  const user = signedIn();
  return () => mine === newestTicket && user === signedIn();
}

export const useLocationProviderStore = create<LocationProviderState>((set) => ({
  settings: null,
  loadFailed: false,
  refresh: async () => {
    const current = ticket();
    try {
      const settings = await locationProviderApi.get();
      if (!current()) return null;
      set({ settings, loadFailed: false });
      return settings;
    } catch {
      if (current()) set({ loadFailed: true });
      return null;
    }
  },
  choose: async (kind) => {
    const current = ticket();
    const settings = await locationProviderApi.set(kind);
    if (current()) set({ settings, loadFailed: false });
    return settings;
  },
  reset: () => {
    newestTicket += 1; // voids every answer still in flight
    set({ settings: null, loadFailed: false });
  },
}));

// Logout, login and an expired session all change the signed-in user.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) useLocationProviderStore.getState().reset();
});

import { create } from "zustand";
import { persistSetting } from "./persistSetting";

/**
 * The account's inbox suggestion switches (forgejo#306): whether the
 * Posteingang offers trip suggestions and Dawarich stay suggestions at all.
 *
 * Its own store rather than more fields on `settingsStore`, which sits at the
 * 800-line limit; `loadRemoteSettings` hands it the same response it reads,
 * the way it feeds `profileZoneStore`. The navigation badge, the inbox and the
 * settings card all subscribe here, so a flip shows everywhere without a
 * reload — the badge re-counts and the tab appears or goes at once.
 *
 * Both default to on, the server's default: until the settings arrive the
 * inbox asks as it always did, and the server, which reads the switch itself,
 * answers a switched-off kind empty without computing it.
 *
 * Not persisted: the server holds the truth, re-learned per session.
 */
interface SuggestionSwitchesState {
  trips: boolean;
  stays: boolean;
  /** What `GET /settings` said; anything that is not a boolean keeps the default. */
  noteRemote: (remote: unknown) => void;
  setTrips: (enabled: boolean) => void;
  setStays: (enabled: boolean) => void;
}

const enabledIn = (group: unknown): boolean | undefined => {
  const value = (group as { enabled?: unknown } | null | undefined)?.enabled;
  return typeof value === "boolean" ? value : undefined;
};

export const useSuggestionSwitchesStore = create<SuggestionSwitchesState>((set, get) => ({
  trips: true,
  stays: true,
  noteRemote: (remote) => {
    const body = remote as { tripSuggestions?: unknown; staySuggestions?: unknown } | null;
    set({
      trips: enabledIn(body?.tripSuggestions) ?? get().trips,
      stays: enabledIn(body?.staySuggestions) ?? get().stays,
    });
  },
  setTrips: (enabled) => {
    const prev = get().trips;
    set({ trips: enabled });
    persistSetting(
      { tripSuggestions: { enabled } },
      () => set({ trips: prev }),
      "trip suggestions switch"
    );
  },
  setStays: (enabled) => {
    const prev = get().stays;
    set({ stays: enabled });
    persistSetting(
      { staySuggestions: { enabled } },
      () => set({ stays: prev }),
      "stay suggestions switch"
    );
  },
}));

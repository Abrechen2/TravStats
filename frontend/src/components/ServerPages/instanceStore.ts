import { create } from "zustand";
import { adminApi } from "../../lib/api";
import type { InstanceSettings, InstanceSettingsPatch, PasskeyStatus } from "../../lib/api/admin";
import { logger } from "../../lib/logger";
import { useAuthStore } from "../../store/authStore";
import { useSettingsStore } from "../../store/settingsStore";

type Load = "idle" | "loading" | "ok" | "failed";

interface InstanceState {
  settings: InstanceSettings | null;
  passkeyStatus: PasskeyStatus | null;
  /** What switching public links off would delete (present on a GET). */
  shareLinkStats: { links: number; accounts: number } | null;
  load: Load;
  /** When the copy was read, for the staleness check. */
  loadedAt: number;
  /**
   * Reads the settings when there is no copy or the copy is older than a minute;
   * a second caller waits for the first. A copy being edited is not disturbed:
   * a group follows the server's value only while the user has not touched it.
   */
  ensureLoaded: () => Promise<void>;
  reload: () => Promise<void>;
  /**
   * Writes one part of the instance settings. Throws when the server refuses, so
   * the row (or group) that asked keeps the user's choice and says why. The
   * server's answer replaces the stored copy: every section reads the same one.
   */
  patch: (patch: InstanceSettingsPatch) => Promise<InstanceSettings>;
}

let inFlight: Promise<void> | null = null;
/** Bumped when the session changes: an answer to an older generation is dropped. */
let generation = 0;
const STALE_AFTER_MS = 60_000;

/**
 * The instance settings of the Server and Nutzer pages, loaded once. Several
 * sections draw from the same document (addresses, passkeys, offers, access),
 * so they read one copy instead of asking four times — and a save in one is
 * seen by the others.
 */
export const useInstanceStore = create<InstanceState>((set, get) => ({
  settings: null,
  passkeyStatus: null,
  shareLinkStats: null,
  load: "idle",
  loadedAt: 0,
  ensureLoaded: async () => {
    if (get().load === "ok" && Date.now() - get().loadedAt < STALE_AFTER_MS) return;
    if (inFlight) return inFlight;
    inFlight = get()
      .reload()
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  reload: async () => {
    // A reload keeps the copy on screen; only a first read has nothing to show.
    if (get().settings === null) set({ load: "loading" });
    const mine = generation;
    try {
      const response = await adminApi.getInstanceSettings();
      if (mine !== generation) return;
      set({
        settings: response.settings,
        passkeyStatus: response.passkeyStatus,
        shareLinkStats: response.shareLinkStats ?? null,
        load: "ok",
        loadedAt: Date.now(),
      });
    } catch (error) {
      logger.error("Failed to load instance settings", error);
      if (mine !== generation) return;
      // A refresh that fails leaves the copy we have; only a first read is "failed".
      if (get().settings === null) set({ load: "failed" });
    }
  },
  patch: async (patch) => {
    const mine = generation;
    const response = await adminApi.updateInstanceSettings(patch);
    if (mine !== generation) return response.settings;
    set({ settings: response.settings, passkeyStatus: response.passkeyStatus });
    // Gated UI (Devices entry, TravTrack, trip AI card) reacts at once instead of after a reload.
    if (patch.betaFeaturesEnabled !== undefined) {
      useSettingsStore.getState().syncBetaFeaturesEnabled(response.settings.betaFeaturesEnabled);
    }
    return response.settings;
  },
}));

/** Test seam: forget what was loaded. */
export function resetInstanceStore(): void {
  inFlight = null;
  generation += 1;
  useInstanceStore.setState({
    settings: null,
    passkeyStatus: null,
    shareLinkStats: null,
    load: "idle",
    loadedAt: 0,
  });
}

// Another account on the same tab must not see the previous one's server settings.
if (typeof useAuthStore.subscribe === "function") {
  useAuthStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) resetInstanceStore();
  });
}

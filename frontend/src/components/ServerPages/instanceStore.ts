import { create } from "zustand";
import { adminApi } from "../../lib/api";
import type { InstanceSettings, InstanceSettingsPatch, PasskeyStatus } from "../../lib/api/admin";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";

type Load = "idle" | "loading" | "ok" | "failed";

interface InstanceState {
  settings: InstanceSettings | null;
  passkeyStatus: PasskeyStatus | null;
  /** What switching public links off would delete (present on a GET). */
  shareLinkStats: { links: number; accounts: number } | null;
  load: Load;
  /** Reads the settings once; a second caller waits for the first. */
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
  ensureLoaded: async () => {
    if (get().load === "ok") return;
    if (inFlight) return inFlight;
    inFlight = get()
      .reload()
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  reload: async () => {
    set({ load: "loading" });
    try {
      const response = await adminApi.getInstanceSettings();
      set({
        settings: response.settings,
        passkeyStatus: response.passkeyStatus,
        shareLinkStats: response.shareLinkStats ?? null,
        load: "ok",
      });
    } catch (error) {
      logger.error("Failed to load instance settings", error);
      set({ load: "failed" });
    }
  },
  patch: async (patch) => {
    const response = await adminApi.updateInstanceSettings(patch);
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
  useInstanceStore.setState({
    settings: null,
    passkeyStatus: null,
    shareLinkStats: null,
    load: "idle",
  });
}

import { create } from "zustand";
import { federationAdminApi } from "../lib/api/federationAdmin";
import { logger } from "../lib/logger";

/**
 * Whether this server connects to other servers (the admin's "Mit anderen
 * Servern verbinden"). The settings menu reads it to decide whether the page
 * "Server-Verbindungen" exists; the switch on "Funktionen" writes it back, so
 * the menu follows at once. `null` = not asked yet, or the answer failed.
 */
export const useFederationStatus = create<{
  enabled: boolean | null;
  set: (enabled: boolean) => void;
  refresh: () => Promise<void>;
}>((set) => ({
  enabled: null,
  set: (enabled) => set({ enabled }),
  refresh: async () => {
    try {
      set({ enabled: (await federationAdminApi.get()).enabled });
    } catch (error) {
      logger.error("Reading the federation switch failed:", error);
    }
  },
}));

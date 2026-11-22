import { create } from "zustand";
import { adminApi } from "../lib/api";
import { logger } from "../lib/logger";

interface DemoAccountState {
  /** An active account named "demo" exists (the server's `demoUserExists && demoUserActive`). */
  active: boolean;
  refresh: () => Promise<void>;
  reset: () => void;
}

/**
 * Whether the demo account is still switched on, for the admin-only header
 * chip and settings-menu notice. One fetch feeds both places; Maintenance calls
 * `refresh()` after it deletes the account so the notice leaves at once.
 * A failed read keeps the last known value and logs: this is a hint, not data.
 */
export const useDemoAccountStore = create<DemoAccountState>((set) => ({
  active: false,
  refresh: async () => {
    try {
      const info = await adminApi.getSystemInfo();
      set({ active: Boolean(info.demoUserExists && info.demoUserActive) });
    } catch (error) {
      logger.warn("Failed to read whether a demo account is active", error);
    }
  },
  reset: () => set({ active: false }),
}));

import { create } from "zustand";

import { sharingApi } from "../lib/api/sharing";
import { logger } from "../lib/logger";
import type { ReceivedTripItem } from "../types/sharing";

/**
 * Trips shared with the reader that they have not looked at yet (2026-11-24): the dashboard
 * banner and the dot on "Reisen" read the same list, loaded with the inbox counts. A failed
 * load keeps the last list and is logged — the inbox says it out loud.
 */
interface ReceivedTripsState {
  items: ReceivedTripItem[];
  load: () => Promise<void>;
  /** The banner was dismissed: arrived trips count as seen (offers stay until answered). */
  markSeen: () => Promise<void>;
}

export const useReceivedTripsStore = create<ReceivedTripsState>((set, get) => ({
  items: [],
  load: async () => {
    try {
      set({ items: (await sharingApi.receivedTrips()).items });
    } catch (error) {
      logger.warn("Failed to load trips shared with you:", error);
    }
  },
  markSeen: async () => {
    await sharingApi.markReceivedTripsSeen();
    set({ items: get().items.filter((i) => i.kind === "offer") });
  },
}));

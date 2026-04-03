import { api } from "./client";

// Analytics API
export const analyticsApi = {
  track: async (type: string, payload?: Record<string, unknown>): Promise<void> => {
    await api.post("/analytics/events", { type, payload });
  },
};

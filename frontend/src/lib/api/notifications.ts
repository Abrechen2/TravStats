import { api } from "./client";
import type { NotificationPreferences, NotificationPreferencesPatch } from "./types";

// Notification preferences API
export const notificationsApi = {
  getPreferences: async (): Promise<NotificationPreferences> => {
    const { data } = await api.get<NotificationPreferences>("/settings/notifications");
    return data;
  },

  updatePreferences: async (
    prefs: NotificationPreferencesPatch
  ): Promise<NotificationPreferences> => {
    const { data } = await api.put<NotificationPreferences>("/settings/notifications", prefs);
    return data;
  },
};

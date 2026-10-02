import { api } from "./client";

export interface PushRelayState {
  pushEnabled: boolean;
  pushRelayUrl: string;
  /** Instance id and secret both present; the secret itself is never sent. */
  registered: boolean;
  pausedUntil: string | null;
  consentAt: string | null;
}

export const pushRelayApi = {
  get: async (): Promise<PushRelayState> => {
    const { data } = await api.get<PushRelayState>("/admin/push");
    return data;
  },
  update: async (patch: {
    pushEnabled?: boolean;
    pushRelayUrl?: string;
  }): Promise<PushRelayState> => {
    const { data } = await api.put<PushRelayState>("/admin/push", patch);
    return data;
  },
  reset: async (): Promise<PushRelayState> => {
    const { data } = await api.post<PushRelayState>("/admin/push/reset");
    return data;
  },
};

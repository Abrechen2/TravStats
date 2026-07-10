import { api } from "./client";

export type UsageStatsConsent = "unset" | "granted" | "denied";

export interface UsageStatsStatus {
  consent: UsageStatsConsent;
  installId: string | null;
  endpointConfigured: boolean;
}

export const usageStatsApi = {
  get: async (): Promise<UsageStatsStatus> => {
    const { data } = await api.get<UsageStatsStatus>("/admin/usage-stats");
    return data;
  },
  setConsent: async (consent: "granted" | "denied"): Promise<UsageStatsStatus> => {
    const { data } = await api.put<UsageStatsStatus>("/admin/usage-stats", { consent });
    return data;
  },
};

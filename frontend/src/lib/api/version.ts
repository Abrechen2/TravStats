import { api } from "./client";

export interface VersionInfo {
  version: string;
  buildVersion: string;
  latestAvailable: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
}

export const versionApi = {
  get: async (): Promise<VersionInfo> => {
    const { data } = await api.get<VersionInfo>("/version");
    return data;
  },
};

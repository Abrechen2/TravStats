import { api } from "./client";
import type {
  ImmichAlbumSummary,
  ImmichConnectionStatus,
  ImmichFailureKind,
  ImmichGalleryAsset,
  ImmichMode,
  ImmichTestResult,
  ImportEstimate,
  ImportJob,
  LinkedAlbum,
} from "../../types/immich";

const FAILURE_KINDS: readonly ImmichFailureKind[] = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
];

/**
 * Pull the machine-readable kind out of a failed Immich request so the gallery
 * can render a specific degraded panel instead of a generic error toast.
 */
export function immichFailureKind(error: unknown): ImmichFailureKind | null {
  if (typeof error !== "object" || error === null) return null;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  const kind = response?.data?.error;
  return typeof kind === "string" && (FAILURE_KINDS as readonly string[]).includes(kind)
    ? (kind as ImmichFailureKind)
    : null;
}

export const immichApi = {
  async getSettings(): Promise<ImmichConnectionStatus> {
    const { data } = await api.get("/settings/immich");
    return data;
  },

  async updateSettings(payload: {
    baseUrl?: string | null;
    apiKey?: string | null;
    defaultMode?: ImmichMode;
  }): Promise<ImmichConnectionStatus> {
    const { data } = await api.put("/settings/immich", payload);
    return data;
  },

  async testConnection(payload: { baseUrl?: string; apiKey?: string }): Promise<ImmichTestResult> {
    const { data } = await api.post("/settings/immich/test", payload);
    return data;
  },

  async getAdminSettings(): Promise<{ baseUrl: string | null; apiKey: string | null }> {
    const { data } = await api.get("/admin/immich");
    return data;
  },

  async updateAdminSettings(payload: {
    baseUrl?: string | null;
    apiKey?: string | null;
  }): Promise<{ baseUrl: string | null; apiKey: string | null }> {
    const { data } = await api.put("/admin/immich", payload);
    return data;
  },

  async testAdminConnection(payload: {
    baseUrl?: string;
    apiKey?: string;
  }): Promise<ImmichTestResult> {
    const { data } = await api.post("/admin/immich/test", payload);
    return data;
  },

  async listAlbums(
    tripId: string,
  ): Promise<{ albums: ImmichAlbumSummary[]; defaultMode: ImmichMode }> {
    const { data } = await api.get(`/trips/${tripId}/immich/albums`);
    return data;
  },

  async linkAlbums(
    tripId: string,
    albums: Array<{ immichAlbumId: string; mode: ImmichMode }>,
  ): Promise<{ links: LinkedAlbum[] }> {
    const { data } = await api.post(`/trips/${tripId}/immich/albums`, { albums });
    return data;
  },

  async unlinkAlbum(tripId: string, linkId: string, deleteCopies: boolean): Promise<void> {
    await api.delete(`/trips/${tripId}/immich/albums/${linkId}?deleteCopies=${deleteCopies}`);
  },

  async getAlbumAssets(
    tripId: string,
    linkId: string,
  ): Promise<{ assets: ImmichGalleryAsset[] }> {
    const { data } = await api.get(`/trips/${tripId}/immich/albums/${linkId}/assets`);
    return data;
  },

  async resyncAlbum(tripId: string, linkId: string): Promise<{ job: ImportJob }> {
    const { data } = await api.post(`/trips/${tripId}/immich/albums/${linkId}/resync`);
    return data;
  },

  async getImportJob(tripId: string, linkId: string): Promise<{ job: ImportJob | null }> {
    const { data } = await api.get(`/trips/${tripId}/immich/albums/${linkId}/import-job`);
    return data;
  },

  async estimateImport(tripId: string, albumId: string): Promise<ImportEstimate> {
    const { data } = await api.get(`/trips/${tripId}/immich/estimate?albumId=${albumId}`);
    return data;
  },

  async setImmichCover(
    tripId: string,
    linkId: string,
    assetId: string,
  ): Promise<{ coverImageUrl: string }> {
    const { data } = await api.post(`/trips/${tripId}/immich/cover`, { linkId, assetId });
    return data;
  },

  async setPhotoCover(tripId: string, photoId: string): Promise<{ coverImageUrl: string }> {
    const { data } = await api.post(`/trips/${tripId}/photos/${photoId}/cover`);
    return data;
  },
};

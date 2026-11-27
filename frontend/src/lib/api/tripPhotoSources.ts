import { api } from "./client";
import type { ImmichFailureKind, PhotoSourceKind } from "../../types/immich";

/** Trip photo links (spec 2026-11-26-trip-photo-links.md): references only, never copies. */

export interface TripPhotoSource {
  id: string;
  kind: "album" | "period";
  provider: PhotoSourceKind;
  connectionId: PhotoSourceKind;
  name: string | null;
  from: string | null;
  until: string | null;
  pinned: boolean;
  auto: boolean;
  count: number | null;
  mode: "link" | "import" | null;
}

export interface AlbumProposal {
  key: string;
  connectionId: PhotoSourceKind;
  albumId: string;
  name: string;
  count: number | null;
  overlapDays: number | null;
  reason: "folder" | "name" | "date";
}

export interface TripPhotoProposals {
  connectionId: PhotoSourceKind | null;
  proposals: AlbumProposal[];
  periodOffer: { connectionId: PhotoSourceKind; from: string; until: string } | null;
  autoLinked: boolean;
  failure: ImmichFailureKind | null;
}

export interface LinkedPhoto {
  key: string;
  provider: PhotoSourceKind;
  sourceId: string;
  sourceKind: "album" | "period";
  url: string;
  previewUrl: string;
  takenAt: string | null;
  day: string | null;
}

export interface LinkedPhotoFailure {
  sourceId: string;
  sourceKind: "album" | "period";
  provider: PhotoSourceKind;
  kind: ImmichFailureKind | "notConfigured";
}

export interface LinkedPhotoPage {
  zone: string;
  totalAll: number;
  total: number;
  days: Array<{ day: string | null; count: number }>;
  photos: LinkedPhoto[];
  nextCursor: string | null;
  truncated: boolean;
  failures: LinkedPhotoFailure[];
}

export const tripPhotoSourcesApi = {
  async list(tripId: string): Promise<TripPhotoSource[]> {
    const { data } = await api.get(`/trips/${tripId}/photo-sources`);
    return data.sources;
  },
  async addPeriod(tripId: string): Promise<TripPhotoSource | null> {
    const { data } = await api.post(`/trips/${tripId}/photo-sources`, { kind: "period" });
    return data.source;
  },
  async addAlbum(
    tripId: string,
    connectionId: PhotoSourceKind,
    albumId: string
  ): Promise<TripPhotoSource | null> {
    const { data } = await api.post(`/trips/${tripId}/photo-sources`, {
      kind: "album",
      connectionId,
      albumId,
    });
    return data.source;
  },
  async remove(tripId: string, sourceId: string): Promise<void> {
    await api.delete(`/trips/${tripId}/photo-sources/${sourceId}`);
  },
  async proposals(tripId: string): Promise<TripPhotoProposals> {
    const { data } = await api.get(`/trips/${tripId}/photo-sources/proposals`);
    return data;
  },
  async dismiss(tripId: string, key: string): Promise<void> {
    await api.post(`/trips/${tripId}/photo-sources/proposals/${encodeURIComponent(key)}/dismiss`);
  },
  async photos(
    tripId: string,
    params: { day?: string; cursor?: string | null; limit?: number } = {}
  ): Promise<LinkedPhotoPage> {
    const { data } = await api.get(`/trips/${tripId}/linked-photos`, {
      params: {
        day: params.day ?? "all",
        ...(params.cursor ? { cursor: params.cursor } : {}),
        limit: params.limit ?? 60,
      },
    });
    return data;
  },
  async getAutoPeriod(): Promise<boolean> {
    const { data } = await api.get("/settings/photo-period-auto");
    return data.enabled;
  },
  async setAutoPeriod(enabled: boolean): Promise<void> {
    await api.put("/settings/photo-period-auto", { enabled });
  },
};

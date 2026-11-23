import { api } from "./client";
import type { PhotoSourceKind } from "../../types/immich";

export type CoverReasonCode =
  "me" | "placeClose" | "placeNearby" | "favorite" | "highQuality" | "landscape" | "resolution";

export type CoverApply =
  | { type: "photo"; photoId: string }
  | { type: "album"; linkId: string; assetId: string }
  | { type: "entry"; linkId: string };

export interface CoverSuggestion {
  key: string;
  thumbUrl: string;
  takenAt: string | null;
  score: number;
  reasons: Array<{ code: CoverReasonCode; points: number }>;
  apply: CoverApply;
}

export type SourceFailure = "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";

export interface CoverSourceStatus {
  provider: PhotoSourceKind;
  photos: "ok" | "notConfigured" | SourceFailure;
  people: "ok" | "notSet" | "notConfigured" | SourceFailure;
}

export interface CoverSuggestions {
  suggestions: CoverSuggestion[];
  abstained: "noTripDates" | "noCandidates" | "noneQualified" | null;
  sources: CoverSourceStatus[];
}

export interface PhotoSourcePerson {
  id: string;
  name: string;
}

export const coverSuggestionsApi = {
  async get(tripId: string): Promise<CoverSuggestions> {
    const { data } = await api.get(`/trips/${tripId}/cover-suggestions`);
    return data;
  },

  /** Write the cover through the route that fits where the photo lives. */
  async apply(tripId: string, apply: CoverApply): Promise<{ coverImageUrl: string }> {
    const path =
      apply.type === "photo"
        ? `/trips/${tripId}/photos/${apply.photoId}/cover`
        : apply.type === "album"
          ? `/trips/${tripId}/immich/cover`
          : `/trips/${tripId}/cover/entry-photo`;
    const body =
      apply.type === "album"
        ? { linkId: apply.linkId, assetId: apply.assetId }
        : apply.type === "entry"
          ? { linkId: apply.linkId }
          : undefined;
    const { data } = await api.post(path, body);
    return data;
  },

  async listPeople(
    provider: PhotoSourceKind
  ): Promise<{ people: PhotoSourcePerson[]; selfPersonId: string | null }> {
    const { data } = await api.get(`/settings/photo-sources/${provider}/people`);
    return data;
  },

  async setSelf(provider: PhotoSourceKind, personId: string | null): Promise<void> {
    await api.put(`/settings/photo-sources/${provider}/self`, { personId });
  },

  async getAuto(): Promise<{ enabled: boolean; autoCovers: number }> {
    const { data } = await api.get("/settings/auto-cover");
    return data;
  },

  async setAuto(enabled: boolean): Promise<void> {
    await api.put("/settings/auto-cover", { enabled });
  },

  /** Removes only the covers the server chose; returns how many. */
  async removeAutoCovers(): Promise<number> {
    const { data } = await api.delete("/settings/auto-cover/covers");
    return data.removed;
  },
};

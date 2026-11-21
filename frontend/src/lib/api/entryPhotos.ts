import { api } from "./client";

/** The entry types that carry linked library photos; see `backend/.../entryKinds.ts`. */
export type EntryPhotoKind =
  "flight" | "stay" | "rail" | "bus" | "ferry" | "rental" | "cruiseStop" | "roadtripStop";

export type EntryPhotoProvider = "immich" | "photoprism";

export interface EntryPhotoLink {
  id: string;
  url: string;
  provider: EntryPhotoProvider;
  assetId: string;
  provenance: "manual" | "auto";
  takenAt: string | null;
  mimetype: string;
}

export interface EntryPhotoSuggestion {
  url: string;
  provider: EntryPhotoProvider;
  assetId: string;
  takenAt: string | null;
  mimetype: string;
}

export interface EntryPhotoSuggestions {
  suggestions: EntryPhotoSuggestion[];
  /** `ok`, `notConfigured`, `truncated` or a failure kind, per source. */
  sources: Partial<Record<EntryPhotoProvider, string>>;
  /** The entry has no usable time or position: nothing can be suggested. */
  untimed: boolean;
}

interface Envelope<T> {
  success: true;
  data: T;
}

const base = (kind: EntryPhotoKind, entryId: string): string => `/entry-photos/${kind}/${entryId}`;

export async function listEntryPhotos(
  kind: EntryPhotoKind,
  entryId: string
): Promise<EntryPhotoLink[]> {
  const res = await api.get<Envelope<{ photos: EntryPhotoLink[] }>>(
    `${base(kind, entryId)}/photos`
  );
  return res.data.data.photos;
}

export async function getEntryPhotoSuggestions(
  kind: EntryPhotoKind,
  entryId: string
): Promise<EntryPhotoSuggestions> {
  const res = await api.get<Envelope<EntryPhotoSuggestions>>(
    `${base(kind, entryId)}/photo-suggestions`
  );
  return res.data.data;
}

export async function linkEntryPhotos(
  kind: EntryPhotoKind,
  entryId: string,
  provider: EntryPhotoProvider,
  assetIds: string[]
): Promise<{ linked: number; skipped: number }> {
  const res = await api.post<Envelope<{ linked: number; skipped: number }>>(
    `${base(kind, entryId)}/photos`,
    { provider, assetIds }
  );
  return res.data.data;
}

export async function removeEntryPhoto(
  kind: EntryPhotoKind,
  entryId: string,
  photoId: string
): Promise<void> {
  await api.delete(`${base(kind, entryId)}/photos/${photoId}`);
}

export async function removeAutoEntryPhotos(
  kind: EntryPhotoKind,
  entryId: string
): Promise<number> {
  const res = await api.delete<Envelope<{ removed: number }>>(`${base(kind, entryId)}/photos/auto`);
  return res.data.data.removed;
}

export async function clearEntryPhotoRefusals(
  kind: EntryPhotoKind,
  entryId: string
): Promise<void> {
  await api.delete(`${base(kind, entryId)}/photo-refusals`);
}

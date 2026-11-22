import { api } from "./client";
import { waitForJob } from "./jobs";
import type { EntryPhotoKind } from "./entryPhotos";

/**
 * "Fotos auswählen" — the candidates of a place visit or any other entry and
 * the user's choice among them. Both surfaces answer in this one shape.
 */
export type ChoiceProvider = "immich" | "photoprism";

export interface PhotoChoice {
  provider: ChoiceProvider;
  assetId: string;
  url: string;
  takenAt: string | null;
  /** Wall clock where it was taken, `YYYY-MM-DDTHH:mm:ss`; null when the server knows no zone. */
  takenAtLocal: string | null;
  /** Metres to the place; null when the source gave no position. */
  distanceM: number | null;
  chosen: boolean;
  provenance: "manual" | "auto" | null;
  /** Removed by the user earlier; shown unticked. */
  refused: boolean;
}

export interface PhotoChoices {
  choices: PhotoChoice[];
  sources: Partial<Record<ChoiceProvider, string>>;
  untimed?: boolean;
  /** Photos the server links on its own per visit/entry. */
  cap: number;
  /** Links into the source's own UI for the photos not chosen; empty without a browsable URL. */
  openIn: { provider: ChoiceProvider; url: string }[];
  /** Entries only: the local days searched (`YYYY-MM-DD`), what "Fotos vom 3.–7. Mai" says. */
  window?: { from: string; to: string };
  /** Entries only: candidates found before the list was thinned. */
  total?: number;
  /** Entries only: `choices` is a spread of `total`; asking for `all` lists every one. */
  thinned?: boolean;
  /** Entries only: the album the candidates came from. */
  album?: AlbumPick;
}

/** "Aus Album wählen": the candidates are one album's photos, never the album linked. */
export interface AlbumPick {
  provider: ChoiceProvider;
  albumId: string;
  /** Regardless of the entry's dates. */
  anyDate: boolean;
}

export interface ChoiceQuery {
  all?: boolean;
  album?: AlbumPick;
}

export interface PhotoAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  kind?: string;
}

export interface ChoiceChange {
  select: { provider: ChoiceProvider; assetId: string }[];
  deselect: { provider: ChoiceProvider; assetId: string }[];
  /** The album the picks were listed from, so the server proves them against it. */
  album?: AlbumPick;
}

export interface ChoiceSaved {
  picked: number;
  swapped: number;
  refused: number;
  skipped: number;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ChoiceTarget =
  { type: "visit"; visitId: string } | { type: "entry"; kind: EntryPhotoKind; entryId: string };

const pathOf = (t: ChoiceTarget): string =>
  t.type === "visit"
    ? `/places/visits/${t.visitId}/photo-choices`
    : `/entry-photos/${t.kind}/${t.entryId}/photo-choices`;

export async function getPhotoChoices(
  target: ChoiceTarget,
  query: ChoiceQuery = {}
): Promise<PhotoChoices> {
  const params: Record<string, string> = {};
  if (query.all) params.all = "1";
  if (query.album) {
    params.provider = query.album.provider;
    params.albumId = query.album.albumId;
    if (query.album.anyDate) params.anyDate = "1";
  }
  const res = await api.get<Envelope<PhotoChoices>>(pathOf(target), { params });
  return res.data.data;
}

/** The albums and folders of one photo source, for an entry (not a visit). */
export async function listPhotoAlbums(
  target: Extract<ChoiceTarget, { type: "entry" }>,
  provider: ChoiceProvider
): Promise<PhotoAlbum[]> {
  const res = await api.get<Envelope<{ albums: PhotoAlbum[] }>>(
    `/entry-photos/${target.kind}/${target.entryId}/photo-albums`,
    { params: { provider } }
  );
  return res.data.data.albums;
}

export async function savePhotoChoices(
  target: ChoiceTarget,
  change: ChoiceChange
): Promise<ChoiceSaved> {
  const res = await api.put<Envelope<ChoiceSaved>>(pathOf(target), change);
  return res.data.data;
}

export interface TrimResult {
  trimmed: number;
  checked: number;
  removed: number;
}

/** Save the per-visit/entry limit; the server then trims what is linked above it (a job). */
export async function setPhotoCap(
  cap: number,
  onProgress?: (progress: { done: number; total: number } | null) => void
): Promise<TrimResult> {
  const res = await api.put<Envelope<{ cap: number; jobId: string }>>(
    "/places/visits/photos/auto-link/cap",
    { cap }
  );
  return waitForJob<TrimResult>(res.data.data.jobId, {
    onPoll: (job) => onProgress?.(job.progress),
  });
}

/** Trim every visit's and entry's automatic links to the cap; idempotent. */
export async function trimPhotoLinks(
  onProgress?: (progress: { done: number; total: number } | null) => void
): Promise<TrimResult> {
  const res = await api.post<Envelope<{ jobId: string }>>("/places/visits/photos/auto-link/trim");
  return waitForJob<TrimResult>(res.data.data.jobId, {
    onPoll: (job) => onProgress?.(job.progress),
  });
}

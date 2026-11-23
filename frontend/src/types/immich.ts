export type ImmichMode = "link" | "import";

/** The photo library an album lives in. `immich` is what every link was before PhotoPrism. */
export type PhotoSourceKind = "immich" | "photoprism";

export type ImmichConnectionSource = "user" | "global";

export interface ImmichConnectionStatus {
  baseUrl: string | null;
  hasKey: boolean;
  defaultMode: ImmichMode;
  source: ImmichConnectionSource | null;
  isShared: boolean;
  hasAccess: boolean;
}

export interface ImmichTestResult {
  success: boolean;
  /** English, for debugging only — the UI renders `errors.<kind>` instead. */
  message: string;
  /** Machine-readable failure classification, present only on failure. */
  kind?: ImmichFailureKind;
  details?: { version?: string; user?: string };
}

export type PhotoSourceAlbumKind = "album" | "folder" | "moment" | "month" | "state";

export interface ImmichAlbumSummary {
  id: string;
  albumName: string;
  /** Null when the source cannot tell (PhotoPrism): show no number, never 0. */
  assetCount: number | null;
  thumbnailAssetId: string | null;
  /** Absent for Immich (always an album); PhotoPrism also sends folders, moments, months, states. */
  kind?: PhotoSourceAlbumKind;
  linked: boolean;
  linkId: string | null;
}

export interface LinkedAlbum {
  id: string;
  provider: PhotoSourceKind;
  immichAlbumId: string;
  albumName: string;
  /** Null when the source cannot tell (PhotoPrism): show no number, never 0. */
  assetCount: number | null;
  thumbnailAssetId: string | null;
  mode: ImmichMode;
  sortIdx: number;
  lastSyncedAt: string | null;
}

export interface ImmichGalleryAsset {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

export interface AlbumDayCount {
  /** `YYYY-MM-DD` in `zone`, or null for photos without a capture time. */
  day: string | null;
  count: number;
}

export interface AlbumDays {
  zone: string;
  truncated: boolean;
  total: number;
  days: AlbumDayCount[];
}

export interface AlbumDayPage {
  day: string;
  total: number;
  offset: number;
  nextOffset: number | null;
  assets: ImmichGalleryAsset[];
}

export interface ImportJob {
  status: "pending" | "running" | "completed" | "failed";
  totalAssets: number;
  processedAssets: number;
  failedAssets: number;
  error: string | null;
}

export interface ImportEstimate {
  assetCount: number;
  /** Null when the source reports no sizes (PhotoPrism): unknown, not zero. */
  totalBytes: number | null;
}

/**
 * Why an Immich-backed request failed. `notConfigured` comes back as 409 from
 * our own API; `invalidUrl` is a rejected base URL (the user's typo); the rest
 * are upstream kinds surfaced as 502. `invalidUrl` and `protocol` are kept
 * distinct so a malformed URL is not misreported as a server-version mismatch.
 *
 * `keyRequired` is the one kind that is not a failure of the server being
 * addressed: the caller asked to test a DIFFERENT target while relying on a
 * key configured for the instance rather than by them. That key stays bound to
 * its own target, so a new one has to be supplied (AUD-087).
 */
export type ImmichFailureKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl" | "keyRequired";

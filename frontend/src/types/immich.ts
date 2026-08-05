export type ImmichMode = "link" | "import";

export type ImmichConnectionSource = "user" | "global" | "env";

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

export interface ImmichAlbumSummary {
  id: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  linked: boolean;
  linkId: string | null;
}

export interface LinkedAlbum {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
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

export interface ImportJob {
  status: "pending" | "running" | "completed" | "failed";
  totalAssets: number;
  processedAssets: number;
  failedAssets: number;
  error: string | null;
}

export interface ImportEstimate {
  assetCount: number;
  totalBytes: number;
}

/**
 * Why an Immich-backed request failed. `notConfigured` comes back as 409 from
 * our own API; `invalidUrl` is a rejected base URL (the user's typo); the rest
 * are upstream kinds surfaced as 502. `invalidUrl` and `protocol` are kept
 * distinct so a malformed URL is not misreported as a server-version mismatch.
 */
export type ImmichFailureKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";

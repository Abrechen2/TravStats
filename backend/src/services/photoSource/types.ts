/**
 * The photo-source layer: what a trip needs from a photo library, independent
 * of which software holds it. Immich is the first implementation
 * (`immichSource.ts`); the routes, the asset proxy, the cover and the import
 * job talk to this interface only.
 *
 * Failures keep the fixed vocabulary
 * `unreachable | auth | notFound | protocol | invalidUrl` (`ImmichErrorKind`):
 * every implementation throws an error carrying one of those `kind`s, because
 * the routes and the frontend's `immichFailureKind()` read nothing else.
 */
import type { Readable } from "node:stream";

import type { PrivateTargetCode } from "../egress/privateTargets";
import type { ImmichErrorKind } from "../immich/types";

export type PhotoSourceKind = "immich" | "photoprism";

export const PHOTO_SOURCE_KINDS: readonly PhotoSourceKind[] = ["immich", "photoprism"];

/** Rendition of an asset the proxy may ask for. */
export type PhotoSourceThumbnailSize = "thumbnail" | "preview";

export interface PhotoSourceAlbum {
  id: string;
  /** Wire name kept from Immich; the routes and the frontend read it as is. */
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
}

export interface PhotoSourceAsset {
  id: string;
  type: "IMAGE" | "VIDEO";
  /** ISO-8601. */
  fileCreatedAt: string;
  originalFileName: string;
  mimeType: string;
  /** Null when the source does not know it — never 0 (abstention). */
  sizeBytes: number | null;
  lat: number | null;
  lon: number | null;
  city?: string;
  country?: string;
}

/** One page of an album's assets. */
export interface PhotoSourceAssetPage {
  assets: PhotoSourceAsset[];
  /** Next page to ask for, or null when this was the last one. */
  nextPage: number | null;
  /**
   * The source had more than this implementation is willing to read, so the
   * list is a prefix of the album, not the album.
   */
  truncated: boolean;
}

export interface PhotoSourceStream {
  stream: Readable | NodeJS.ReadableStream;
  contentType: string;
  contentLength: number | null;
}

export interface PhotoSourceTestResult {
  success: boolean;
  /** English, for logs. The UI renders a localized string keyed off `kind`. */
  message: string;
  kind?: ImmichErrorKind;
  /** `PRIVATE_TARGET` beside `invalidUrl`: a host this account may not reach. */
  code?: PrivateTargetCode;
  details?: { version?: string; user?: string };
}

export interface PhotoSourceProvider {
  readonly kind: PhotoSourceKind;
  test(): Promise<PhotoSourceTestResult>;
  listAlbums(): Promise<PhotoSourceAlbum[]>;
  /** `page` is 0-based; follow `nextPage` until it is null. */
  listAlbumAssets(albumId: string, page: number): Promise<PhotoSourceAssetPage>;
  streamThumbnail(assetId: string, size: PhotoSourceThumbnailSize): Promise<PhotoSourceStream>;
  streamOriginal(assetId: string): Promise<PhotoSourceStream>;
}

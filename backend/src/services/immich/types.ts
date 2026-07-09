/**
 * Shared vocabulary for the Immich integration.
 *
 * Everything that crosses a module boundary lives here so the client, the
 * resolver, the import pipeline and the routes agree on one set of names.
 */

/** How a linked album stores its photos. */
export type ImmichMode = "link" | "import";

/**
 * Which rendition of an asset to fetch. Immich serves `thumbnail` (small webp
 * grid tile) and `preview` (large jpeg) from `/assets/:id/thumbnail?size=`,
 * and the untouched file from `/assets/:id/original`.
 */
export type ImmichAssetSize = "thumbnail" | "preview" | "original";

/** Which settings tier supplied the connection. */
export type ImmichConnectionSource = "user" | "global" | "env";

export interface ImmichConnection {
  /** Normalised, no trailing slash, no credentials. */
  baseUrl: string;
  /** Decrypted. Never leaves the backend. */
  apiKey: string;
  source: ImmichConnectionSource;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
}

export interface ImmichAsset {
  id: string;
  type: "IMAGE" | "VIDEO";
  /** ISO-8601. */
  fileCreatedAt: string;
  originalFileName: string;
  mimeType: string;
  /** From `exifInfo.fileSizeInByte` — null when Immich has no EXIF row yet. */
  sizeBytes: number | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Why an Immich call failed. The route layer maps these onto HTTP status codes
 * and the UI maps them onto distinct messages ("bad URL" vs "bad key" vs
 * "unexpected response"), which is the whole point of separating them.
 */
export type ImmichErrorKind = "unreachable" | "auth" | "notFound" | "protocol";

export class ImmichError extends Error {
  public readonly kind: ImmichErrorKind;
  public readonly status?: number;

  constructor(kind: ImmichErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ImmichError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Validate and canonicalise a user-supplied Immich base URL.
 *
 * This is a security boundary, not cosmetics: the asset proxy builds every
 * upstream URL from this value, so it must be a plain http(s) origin with no
 * credentials, query or fragment. A sub-path is allowed (reverse-proxy
 * installs mount Immich under e.g. `/immich`).
 */
export function normalizeImmichBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ImmichError("protocol", "Immich URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImmichError("protocol", "Immich URL must use http:// or https://");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

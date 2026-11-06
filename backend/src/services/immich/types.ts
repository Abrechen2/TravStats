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

import {
  PrivateTargetError,
  assertTargetAllowed,
  type PrivateTargetCode,
  type TargetPolicy,
} from "../egress/privateTargets";

/** Which settings tier supplied the connection. */
export type ImmichConnectionSource = "user" | "global";

export interface ImmichConnection {
  /** Normalised, no trailing slash, no credentials. */
  baseUrl: string;
  /** Decrypted. Never leaves the backend. */
  apiKey: string;
  source: ImmichConnectionSource;
  /**
   * May this connection reach a private, loopback or link-local address?
   * True for the admin-global/ENV tier and for an admin's own connection;
   * false for an ordinary account's own one (forgejo#411,
   * `services/egress/privateTargets.ts`). Checked on every request.
   */
  allowPrivate: boolean;
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
  /**
   * Immich's own reverse-geocoded place of the photo (`exifInfo.city` /
   * `exifInfo.country`), present only where Immich has one. A hint, not a
   * fact: Immich geocodes to the nearest settlement it knows.
   */
  city?: string;
  country?: string;
}

/**
 * Why an Immich call failed. The route layer maps these onto HTTP status codes
 * and the UI maps them onto distinct messages ("bad URL" vs "bad key" vs
 * "unexpected response"), which is the whole point of separating them.
 *
 * `invalidUrl` is the user's own typo (a malformed / non-http base URL, caught
 * before any request leaves the process); `protocol` means Immich actually
 * answered but the payload/version was not what we expect. Conflating the two
 * misleads a user who fat-fingered their URL into debugging their Immich
 * version, so they stay separate kinds.
 */
export type ImmichErrorKind = "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";

export class ImmichError extends Error {
  public readonly kind: ImmichErrorKind;
  public readonly status?: number;
  /** Set on an `invalidUrl` refusal of a target this caller may not reach. */
  public readonly code?: PrivateTargetCode;

  constructor(kind: ImmichErrorKind, message: string, status?: number, code?: PrivateTargetCode) {
    super(message);
    this.name = "ImmichError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate and canonicalise a user-supplied Immich base URL.
 *
 * This is a security boundary, not cosmetics: the asset proxy builds every
 * upstream URL from this value, so it must be a plain http(s) origin with no
 * credentials, query or fragment. A sub-path is allowed (reverse-proxy
 * installs mount Immich under e.g. `/immich`).
 *
 * Egress (forgejo#411): `policy` decides whether the host may be private.
 * An ordinary account's own connection may not name a private, loopback or
 * link-local host (`invalidUrl` with code `PRIVATE_TARGET`); the admin-global
 * tier, ENV and an admin's own connection keep LAN access, since a self-hosted
 * Immich lives on the LAN by design. A public-looking name is checked again
 * at connection time, see `services/egress/privateTargets.ts`.
 */
export function normalizeImmichBaseUrl(raw: string, policy: TargetPolicy): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ImmichError("invalidUrl", "Immich URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImmichError("invalidUrl", "Immich URL must use http:// or https://");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const normalized = `${parsed.protocol}//${parsed.host}${path}`;
  try {
    assertTargetAllowed(normalized, policy);
  } catch (error) {
    if (error instanceof PrivateTargetError) throw privateTargetImmichError();
    throw error;
  }
  return normalized;
}

/** The refusal of a host this caller may not reach, in Immich's vocabulary. */
export function privateTargetImmichError(): ImmichError {
  return new ImmichError(
    "invalidUrl",
    "Immich URL points to a private address this account may not reach",
    undefined,
    "PRIVATE_TARGET"
  );
}

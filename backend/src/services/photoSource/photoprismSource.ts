/**
 * PhotoPrism as a `PhotoSourceProvider`.
 *
 * Every fact below was measured against a real instance, see
 * `docs/superpowers/specs/2026-11-20-photoprism-api-facts.md`:
 *  - the credential is an app password sent as `Bearer`; its scope must be
 *    `albums photos files config`, because `GET /config` is where the two URL
 *    tokens come from and only a `config` scope puts them there;
 *  - thumbnails are `/t/<hash>/<previewToken>/<size>`, originals
 *    `/dl/<hash>?t=<downloadToken>`; a bad token answers `403` with a small SVG
 *    placeholder body, so the status decides, never the content type, and that
 *    body is never forwarded;
 *  - the asset id used throughout TravStats is the file `Hash` (what `/t/` and
 *    `/dl/` take, and what the proxy can validate as plain hex);
 *  - `Lat: 0, Lng: 0` means "no GPS", `TakenAt` is UTC and only trustworthy
 *    when `TakenSrc` is set.
 *
 * Tokens are fetched server-side, cached briefly and refreshed once after a
 * 403. They never reach the browser: the asset proxy is the only path.
 */
import axios, { type AxiosRequestConfig } from "axios";
import { createHash } from "node:crypto";
import type { ClientRequest } from "http";

import logger from "../../utils/logger";
import {
  PrivateTargetError,
  assertTargetAllowed,
  axiosAgentsFor,
  isPrivateTargetRefusal,
} from "../egress/privateTargets";
import { ImmichError, privateTargetImmichError, type ImmichConnection } from "../immich/types";
import type {
  PhotoSourceAlbum,
  PhotoSourceAsset,
  PhotoSourceAssetPage,
  PhotoSourceProvider,
  PhotoSourceStream,
  PhotoSourceTestResult,
  PhotoSourceThumbnailSize,
} from "./types";

const SERVICE = "PhotoPrism";
const REQUEST_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 60_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;
/** Page size of `GET /photos`; a shorter page is the last one (no total is sent). */
export const PHOTOPRISM_PAGE_SIZE = 500;
/** `count` of the album listing; 5000 was accepted without a visible cap. */
const ALBUM_COUNT = 5000;
/** The download token lives 3600 s; the preview token has no measured expiry. */
export const PHOTOPRISM_TOKEN_TTL_MS = 10 * 60_000;
/**
 * First build that has app passwords with scopes and the `s=` album filter.
 * An assumption, not a measurement (only 261029 was measured): an older build
 * answers `protocol` instead of failing later in a confusing way.
 */
export const PHOTOPRISM_MIN_BUILD = 230101;

const THUMB_SIZE: Record<PhotoSourceThumbnailSize, string> = {
  thumbnail: "tile_500",
  preview: "fit_1280",
};
const STREAMABLE = /^(image|video)\//i;
const ACTIVE_IMAGE = /^image\/svg/i;
/** An asset id is a file hash; anything else never reaches a URL. */
const HASH = /^[0-9a-f]{16,64}$/i;
const ALBUM_UID = /^[A-Za-z0-9_-]{1,64}$/;
const NO_CAPTURE_TIME = new Date(0).toISOString();

interface Tokens {
  preview: string;
  download: string;
  fetchedAt: number;
}

const tokenCache = new Map<string, Tokens>();

/** Test seam. Never called from production code. */
export function clearPhotoprismTokenCache(): void {
  tokenCache.clear();
}

const cacheKey = (conn: ImmichConnection): string =>
  `${conn.baseUrl}\n${createHash("sha256").update(conn.apiKey).digest("hex")}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The build number of `261029-963b58c50-Linux-AMD64-Plus`, or null. */
export function photoprismBuild(version: string): number | null {
  const match = /^(\d{6})(?:-|$)/.exec(version.trim());
  return match ? Number(match[1]) : null;
}

function destroyBody(error: unknown): void {
  const data = isRecord(error) && isRecord(error.response) ? error.response.data : undefined;
  if (isRecord(data) && typeof data.destroy === "function") {
    (data as { destroy: () => void }).destroy();
  }
}

/** Axios failure -> the fixed kinds. Never carries a URL (tokens sit in them). */
function toError(error: unknown, context: string): ImmichError {
  if (error instanceof ImmichError) return error;
  if (isPrivateTargetRefusal(error)) return privateTargetImmichError(SERVICE);
  if (isRecord(error) && error.isAxiosError === true) {
    const response = isRecord(error.response) ? error.response : undefined;
    const status = typeof response?.status === "number" ? response.status : undefined;
    if (status === 401 || status === 403) {
      return new ImmichError("auth", `${SERVICE} rejected the app password (${context})`, status);
    }
    if (status === 404) {
      return new ImmichError("notFound", `${SERVICE} resource not found (${context})`, 404);
    }
    if (status === undefined || status >= 500) {
      return new ImmichError("unreachable", `${SERVICE} is unreachable (${context})`, status);
    }
    return new ImmichError("protocol", `${SERVICE} returned ${status} for ${context}`, status);
  }
  logger.error({ message: "photoprism_client_unexpected_error", error, context: { context } });
  return new ImmichError("protocol", `Unexpected ${SERVICE} failure (${context})`);
}

function mapAsset(raw: unknown): PhotoSourceAsset | null {
  if (!isRecord(raw)) return null;
  const hash = str(raw.Hash);
  if (!HASH.test(hash)) return null;
  const kind = str(raw.Type).toLowerCase();
  // Documents, audio and the like never belong in a photo gallery.
  const type =
    kind === "video"
      ? "VIDEO"
      : ["", "image", "raw", "live", "animated"].includes(kind)
        ? "IMAGE"
        : null;
  if (type === null) return null;

  const lat = typeof raw.Lat === "number" ? raw.Lat : null;
  const lon = typeof raw.Lng === "number" ? raw.Lng : null;
  // 0/0 is how PhotoPrism says "no GPS"; a real fix there is open sea.
  const hasPosition = lat !== null && lon !== null && !(lat === 0 && lon === 0);

  // TakenAt without TakenSrc is only the file's modification time: not a capture time.
  const taken = Date.parse(str(raw.TakenAt));
  const fileCreatedAt =
    str(raw.TakenSrc) !== "" && Number.isFinite(taken)
      ? new Date(taken).toISOString()
      : NO_CAPTURE_TIME;

  const fileName = str(raw.FileName);
  return {
    id: hash,
    type,
    fileCreatedAt,
    originalFileName: fileName ? (fileName.split("/").pop() ?? fileName) : `${hash}.bin`,
    mimeType: "application/octet-stream",
    sizeBytes: null,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
  };
}

export function createPhotoprismPhotoSource(
  conn: ImmichConnection,
  options: { streamIdleTimeoutMs?: number } = {}
): PhotoSourceProvider {
  // No redirects for anyone; an account that may not reach the LAN is pinned to
  // public addresses and never goes through an env proxy (forgejo#411).
  const transport: AxiosRequestConfig = {
    maxRedirects: 0,
    ...axiosAgentsFor(conn),
    ...(conn.allowPrivate ? {} : { proxy: false as const }),
  };
  const bearer = { Authorization: `Bearer ${conn.apiKey}` };
  const idleTimeoutMs = options.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;

  const url = (suffix: string): string => {
    try {
      assertTargetAllowed(conn.baseUrl, conn);
    } catch (error) {
      if (error instanceof PrivateTargetError) throw privateTargetImmichError(SERVICE);
      throw error;
    }
    return `${conn.baseUrl}/api/v1${suffix}`;
  };

  async function getJson(
    suffix: string,
    context: string,
    authenticated: boolean
  ): Promise<unknown> {
    try {
      const { data } = await axios.get(url(suffix), {
        headers: authenticated ? bearer : {},
        timeout: REQUEST_TIMEOUT_MS,
        ...transport,
      });
      return data;
    } catch (error) {
      throw toError(error, context);
    }
  }

  /** `GET /config` is public but carries the tokens only for a scoped app password. */
  async function readVersion(): Promise<string> {
    const config = await getJson("/config", "config", false);
    const version = isRecord(config) ? str(config.version) : "";
    const build = photoprismBuild(version);
    if (build === null) {
      throw new ImmichError("protocol", `${SERVICE} returned no usable version`);
    }
    if (build < PHOTOPRISM_MIN_BUILD) {
      throw new ImmichError("protocol", `${SERVICE} build ${build} is too old`);
    }
    return version;
  }

  async function fetchTokens(): Promise<Tokens> {
    const config = await getJson("/config", "config", true);
    const preview = isRecord(config) ? str(config.previewToken) : "";
    const download = isRecord(config) ? str(config.downloadToken) : "";
    if (!preview || !download) {
      // The app password works but its scope has no `config`: say so, not "unreachable".
      logger.warn({ message: "photoprism_tokens_missing", context: { scope: "config" } });
      throw new ImmichError("auth", `${SERVICE} app password lacks the config scope`);
    }
    const tokens = { preview, download, fetchedAt: Date.now() };
    tokenCache.set(cacheKey(conn), tokens);
    return tokens;
  }

  async function tokens(forceRefresh = false): Promise<Tokens> {
    const cached = tokenCache.get(cacheKey(conn));
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < PHOTOPRISM_TOKEN_TTL_MS) {
      return cached;
    }
    return fetchTokens();
  }

  /** A stream from `build(tokens)`; one refresh of the tokens after a 403. */
  async function stream(context: string, build: (t: Tokens) => string): Promise<PhotoSourceStream> {
    let refreshed = false;
    let current = await tokens();
    for (;;) {
      let response;
      try {
        response = await axios.get(url(build(current)), {
          timeout: STREAM_TIMEOUT_MS,
          responseType: "stream",
          ...transport,
        });
      } catch (error) {
        destroyBody(error);
        const failure = toError(error, context);
        if (failure.kind === "auth" && !refreshed) {
          refreshed = true;
          logger.warn({ message: "photoprism_token_refresh", context: { context } });
          current = await tokens(true);
          continue;
        }
        throw failure;
      }

      const body = response.data as NodeJS.ReadableStream & { destroy?: () => void };
      const contentType = str(response.headers["content-type"]);
      if (!STREAMABLE.test(contentType) || ACTIVE_IMAGE.test(contentType)) {
        body.destroy?.();
        throw new ImmichError(
          "protocol",
          `${SERVICE} answered ${context} with a non-media type (${contentType || "none"})`
        );
      }
      const request = response.request as ClientRequest | undefined;
      if (request && typeof request.setTimeout === "function") {
        request.setTimeout(idleTimeoutMs, () => {
          request.destroy(new ImmichError("unreachable", `${SERVICE} stalled on ${context}`));
        });
      }
      const rawLength = response.headers["content-length"];
      const length = typeof rawLength === "string" ? Number(rawLength) : NaN;
      return {
        stream: body,
        contentType,
        contentLength: Number.isFinite(length) ? length : null,
      };
    }
  }

  const requireHash = (assetId: string): string => {
    if (!HASH.test(assetId)) throw new ImmichError("notFound", `${SERVICE} asset id is not a hash`);
    return assetId;
  };

  return {
    kind: "photoprism",

    /** Version first (anonymous), then the credential, then the tokens — a wrong URL never reads as a wrong password. */
    async test(): Promise<PhotoSourceTestResult> {
      try {
        const version = await readVersion();
        await getJson("/albums?type=album&count=1", "albums", true);
        await fetchTokens();
        return { success: true, message: `Connected to ${SERVICE}`, details: { version } };
      } catch (error) {
        if (error instanceof ImmichError) {
          return {
            success: false,
            kind: error.kind,
            ...(error.code ? { code: error.code } : {}),
            message: error.message,
          };
        }
        return { success: false, kind: "unreachable", message: `Could not reach ${SERVICE}` };
      }
    },

    async listAlbums(): Promise<PhotoSourceAlbum[]> {
      // `count` AND `type` are both required; either alone is a 400/403.
      const data = await getJson(`/albums?type=album&count=${ALBUM_COUNT}`, "albums", true);
      if (!Array.isArray(data)) {
        throw new ImmichError("protocol", `${SERVICE} returned an unexpected album payload`);
      }
      return data.filter(isRecord).flatMap((raw) => {
        const id = str(raw.UID);
        if (!ALBUM_UID.test(id)) return [];
        const cover = str(raw.Thumb);
        return [
          {
            id,
            albumName: str(raw.Title),
            assetCount: typeof raw.PhotoCount === "number" ? raw.PhotoCount : 0,
            thumbnailAssetId: HASH.test(cover) ? cover : null,
          },
        ];
      });
    },

    async listAlbumAssets(albumId: string, page: number): Promise<PhotoSourceAssetPage> {
      if (!ALBUM_UID.test(albumId)) {
        throw new ImmichError("notFound", `${SERVICE} album id is not a UID`);
      }
      const offset = page * PHOTOPRISM_PAGE_SIZE;
      // `order=oldest` explicitly: the default is newest first.
      const data = await getJson(
        `/photos?s=${albumId}&count=${PHOTOPRISM_PAGE_SIZE}&offset=${offset}&order=oldest`,
        `photos album=${albumId}`,
        true
      );
      if (!Array.isArray(data)) {
        throw new ImmichError("protocol", `${SERVICE} returned an unexpected photo payload`);
      }
      const assets = data.map(mapAsset).filter((a): a is PhotoSourceAsset => a !== null);
      return {
        assets,
        nextPage: data.length >= PHOTOPRISM_PAGE_SIZE ? page + 1 : null,
        truncated: false,
      };
    },

    streamThumbnail: (assetId, size) =>
      stream(
        `thumbnail ${size}`,
        (t) => `/t/${requireHash(assetId)}/${encodeURIComponent(t.preview)}/${THUMB_SIZE[size]}`
      ),

    streamOriginal: (assetId) =>
      stream("original", (t) => `/dl/${requireHash(assetId)}?t=${encodeURIComponent(t.download)}`),
  };
}

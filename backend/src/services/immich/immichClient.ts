/**
 * Typed wrapper around the Immich REST API.
 *
 * Pinned to Immich OpenAPI **3.0.1**. This is the ONLY file that knows Immich's
 * paths and payload shapes — when Immich shifts its API again (it has before:
 * `/api/asset` -> `/api/assets`), this file is the entire blast radius.
 *
 * Two shapes worth remembering:
 *  - `AlbumResponseDto` carries NO asset array. Album contents come from
 *    `POST /search/metadata` with `albumIds`, which is paginated.
 *  - `size=original` on `/assets/:id/thumbnail` is deprecated in v3; the
 *    original has its own endpoint.
 */
import axios, { AxiosRequestConfig } from "axios";
import logger from "../../utils/logger";
import {
  ImmichAlbum,
  ImmichAsset,
  ImmichAssetSize,
  ImmichConnection,
  ImmichError,
} from "./types";

/** Immich caps `size` at 1000. */
const PAGE_SIZE = 1000;
/** Hard stop so a misbehaving server can never spin us forever. */
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15_000;
/** Streaming a full-size original over a slow LAN needs more headroom. */
const STREAM_TIMEOUT_MS = 60_000;

export interface ImmichAssetStream {
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number | null;
}

export interface ImmichIdentity {
  id: string;
  email: string;
  name: string;
}

export interface ImmichClient {
  getServerVersion(): Promise<string>;
  whoami(): Promise<ImmichIdentity>;
  listAlbums(): Promise<ImmichAlbum[]>;
  listAlbumAssets(albumId: string): Promise<ImmichAsset[]>;
  fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Normalise anything thrown by axios into the four kinds the UI distinguishes.
 * An unknown non-axios throw is a protocol error — we never leak a raw stack.
 */
function toImmichError(error: unknown, context: string): ImmichError {
  if (error instanceof ImmichError) return error;

  if (isRecord(error) && error.isAxiosError === true) {
    const response = isRecord(error.response) ? error.response : undefined;
    const status = typeof response?.status === "number" ? response.status : undefined;

    if (status === 401 || status === 403) {
      return new ImmichError("auth", "Immich rejected the API key", status);
    }
    if (status === 404) {
      return new ImmichError("notFound", `Immich resource not found (${context})`, 404);
    }
    if (status === undefined || status >= 500) {
      return new ImmichError("unreachable", `Immich is unreachable (${context})`, status);
    }
    return new ImmichError("protocol", `Immich returned ${status} for ${context}`, status);
  }

  // Not an axios error at all — something genuinely unexpected (a programming
  // error, a thrown non-Error value, ...). The ImmichError we return keeps the
  // taxonomy the routes/UI depend on, but the original error and its stack
  // would otherwise vanish entirely, so log it here to keep the diagnostic
  // trail.
  logger.error({
    message: "immich_client_unexpected_error",
    error,
    context: { endpoint: context },
  });

  return new ImmichError("protocol", `Unexpected Immich failure (${context})`);
}

function mapAsset(raw: unknown): ImmichAsset | null {
  // A non-string OR empty id would build `/assets//original` — drop it, for
  // symmetry with `listAlbums`'s strict `id.length > 0` filter.
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  // Immich also has non-photo/video asset kinds (e.g. AUDIO). Coercing an
  // unexpected type into IMAGE would route it into the photo pipeline; drop
  // it instead — the caller already filters out `null`.
  if (raw.type !== "IMAGE" && raw.type !== "VIDEO") return null;
  const exif = isRecord(raw.exifInfo) ? raw.exifInfo : undefined;

  return {
    id: raw.id,
    type: raw.type,
    fileCreatedAt: asString(raw.fileCreatedAt, new Date(0).toISOString()),
    originalFileName: asString(raw.originalFileName, `${raw.id}.bin`),
    mimeType: asString(raw.originalMimeType, "application/octet-stream"),
    sizeBytes: asNumberOrNull(exif?.fileSizeInByte),
    lat: asNumberOrNull(exif?.latitude),
    lon: asNumberOrNull(exif?.longitude),
  };
}

export function createImmichClient(conn: ImmichConnection): ImmichClient {
  const headers = { "x-api-key": conn.apiKey };
  const jsonConfig: AxiosRequestConfig = { headers, timeout: REQUEST_TIMEOUT_MS };
  const url = (suffix: string): string => `${conn.baseUrl}/api${suffix}`;

  return {
    async getServerVersion(): Promise<string> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/server/version"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "server/version");
      }
      if (!isRecord(data) || typeof data.major !== "number") {
        throw new ImmichError("protocol", "Immich returned an unexpected version payload");
      }
      return `${data.major}.${data.minor}.${data.patch}`;
    },

    async whoami(): Promise<ImmichIdentity> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/users/me"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "users/me");
      }
      if (!isRecord(data) || typeof data.id !== "string") {
        throw new ImmichError("protocol", "Immich returned an unexpected identity payload");
      }
      return {
        id: data.id,
        email: asString(data.email, ""),
        name: asString(data.name, ""),
      };
    },

    async listAlbums(): Promise<ImmichAlbum[]> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/albums"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "albums");
      }
      if (!Array.isArray(data)) {
        throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      }
      // A missing/non-string id would otherwise collide as `{ id: "" }` — drop
      // it instead, consistent with mapAsset's handling of malformed assets.
      return data
        .filter(isRecord)
        .filter(
          (raw): raw is Record<string, unknown> & { id: string } =>
            typeof raw.id === "string" && raw.id.length > 0,
        )
        .map((raw) => ({
          id: raw.id,
          albumName: asString(raw.albumName, ""),
          assetCount: asNumberOrNull(raw.assetCount) ?? 0,
          thumbnailAssetId:
            typeof raw.albumThumbnailAssetId === "string" ? raw.albumThumbnailAssetId : null,
        }));
    },

    async listAlbumAssets(albumId: string): Promise<ImmichAsset[]> {
      const collected: ImmichAsset[] = [];
      let truncated = false;

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        let data: unknown;
        try {
          ({ data } = await axios.post(
            url("/search/metadata"),
            { albumIds: [albumId], withExif: true, page, size: PAGE_SIZE },
            jsonConfig,
          ));
        } catch (error) {
          throw toImmichError(error, `search/metadata album=${albumId}`);
        }

        const assets = isRecord(data) && isRecord(data.assets) ? data.assets : undefined;
        if (!assets || !Array.isArray(assets.items)) {
          throw new ImmichError("protocol", "Immich returned an unexpected search payload");
        }

        for (const raw of assets.items) {
          const mapped = mapAsset(raw);
          if (mapped) collected.push(mapped);
        }

        if (typeof assets.nextPage !== "string") break;
        // Immich still reports more pages, but we've hit the hard cap — the
        // gallery this returns is a silent partial unless we say so here.
        if (page === MAX_PAGES) truncated = true;
      }

      if (truncated) {
        logger.warn({
          message: "immich_album_assets_truncated",
          context: { albumId, maxPages: MAX_PAGES, collectedCount: collected.length },
        });
      }

      return collected;
    },

    /**
     * Returns a live upstream stream. The caller owns it: attach an `error`
     * listener or pipe it through `stream/promises` `pipeline()` — adding a
     * listener here would swallow errors the caller needs to see (or react to
     * with e.g. `res.destroy()`).
     *
     * `STREAM_TIMEOUT_MS` only bounds axios' connect/header phase; once the
     * response starts streaming, axios enforces no timeout on the body
     * transfer for `responseType: "stream"` — the name promises more than it
     * delivers here.
     */
    async fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream> {
      const suffix =
        size === "original"
          ? `/assets/${assetId}/original`
          : `/assets/${assetId}/thumbnail?size=${size}`;

      try {
        const response = await axios.get(url(suffix), {
          headers,
          timeout: STREAM_TIMEOUT_MS,
          responseType: "stream",
        });
        const rawLength = response.headers["content-length"];
        const contentLength = typeof rawLength === "string" ? Number(rawLength) : NaN;

        return {
          stream: response.data as NodeJS.ReadableStream,
          contentType: asString(response.headers["content-type"], "application/octet-stream"),
          contentLength: Number.isFinite(contentLength) ? contentLength : null,
        };
      } catch (error) {
        throw toImmichError(error, `assets/${assetId} size=${size}`);
      }
    },
  };
}

/**
 * Immich as a `PhotoSourceProvider` — a thin adapter over `ImmichClient`.
 * No behaviour of its own: egress policy, timeouts, content-type filtering and
 * the error vocabulary all stay in `immichClient.ts`.
 */
import { createImmichClient } from "../immich/immichClient";
import { ImmichError, type ImmichConnection } from "../immich/types";
import type { PhotoSourceProvider, PhotoSourceTestResult } from "./types";

export function createImmichPhotoSource(connection: ImmichConnection): PhotoSourceProvider {
  const client = createImmichClient(connection);

  return {
    kind: "immich",

    /** Version first (unauthenticated), identity second — a wrong URL never reads as a wrong key. */
    async test(): Promise<PhotoSourceTestResult> {
      try {
        const version = await client.getServerVersion();
        const identity = await client.whoami();
        return {
          success: true,
          message: "Connected to Immich",
          details: { version, user: identity.name },
        };
      } catch (error) {
        if (error instanceof ImmichError) {
          return {
            success: false,
            kind: error.kind,
            ...(error.code ? { code: error.code } : {}),
            message: error.message,
          };
        }
        return { success: false, kind: "unreachable", message: "Could not reach Immich" };
      }
    },

    listAlbums: () => client.listAlbums(),

    /**
     * Immich's client already reads every page (bounded by its own cap), so the
     * whole album comes back as page 0 and there is no next page.
     */
    async listAlbumAssets(albumId, page) {
      if (page > 0) return { assets: [], nextPage: null, truncated: false };
      const list = await client.listAlbumAssets(albumId);
      return { assets: list, nextPage: null, truncated: list.truncated === true };
    },

    searchAssetsByTime: (range, filter) => client.searchAssetsByDate(range, filter),

    listPeople: () => client.listPeople(),

    streamThumbnail: (assetId, size) => client.fetchAssetStream(assetId, size),
    streamOriginal: (assetId) => client.fetchAssetStream(assetId, "original"),
  };
}

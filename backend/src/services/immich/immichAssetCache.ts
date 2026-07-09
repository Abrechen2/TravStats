/**
 * In-memory TTL cache of album -> asset-list metadata.
 *
 * Images are deliberately NOT cached (spec §5): the proxy streams them through
 * with browser cache headers, so server-side image storage stays at zero for
 * link-mode albums. Only this listing is cached, so re-rendering a trip does
 * not re-hit Immich for every tile.
 *
 * In-flight loads are shared, so N concurrent gallery sections asking for the
 * same album produce exactly one upstream request.
 */
import { ImmichAsset } from "./types";

export const ASSET_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  assets: ImmichAsset[];
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ImmichAsset[]>>();

const keyOf = (userId: string, albumId: string): string => `${userId}::${albumId}`;

export async function getCachedAlbumAssets(
  userId: string,
  albumId: string,
  load: () => Promise<ImmichAsset[]>,
): Promise<ImmichAsset[]> {
  const key = keyOf(userId, albumId);

  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.assets;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  // A failed load must not be cached — `finally` clears the in-flight slot so
  // the next caller retries upstream instead of adopting a rejected promise.
  const promise = load()
    .then((assets) => {
      entries.set(key, { assets, expiresAt: Date.now() + ASSET_CACHE_TTL_MS });
      return assets;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

export function invalidateAlbumAssets(userId: string, albumId: string): void {
  entries.delete(keyOf(userId, albumId));
}

/** Test seam. Never called from production code. */
export function clearImmichAssetCache(): void {
  entries.clear();
  inFlight.clear();
}

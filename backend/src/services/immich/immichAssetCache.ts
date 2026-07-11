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

// Per-key generation counter. Bumped by `invalidateAlbumAssets` so that a
// load already in flight when an invalidation happens can detect it was
// superseded and skip writing its (now stale) result into `entries`.
const generations = new Map<string, number>();

const keyOf = (userId: string, albumId: string): string => JSON.stringify([userId, albumId]);

const generationOf = (key: string): number => generations.get(key) ?? 0;

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

  const generation = generationOf(key);

  // A failed load must not be cached — `finally` clears the in-flight slot so
  // the next caller retries upstream instead of adopting a rejected promise.
  const promise: Promise<ImmichAsset[]> = load()
    .then((assets) => {
      // Only write back if no invalidation happened while this load was in
      // flight. Otherwise we'd resurrect data fetched before the
      // invalidation, silently serving it stale for up to a full TTL
      // window — the caller still gets `assets` below, only the cache
      // write is suppressed.
      if (generationOf(key) === generation) {
        entries.set(key, { assets, expiresAt: Date.now() + ASSET_CACHE_TTL_MS });
      }
      return assets;
    })
    .finally(() => {
      // Only retract our own registration. An invalidation may have replaced it
      // with a newer load, and deleting by key alone would orphan that load's
      // in-flight entry and cause a redundant upstream call.
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

export function invalidateAlbumAssets(userId: string, albumId: string): void {
  const key = keyOf(userId, albumId);
  generations.set(key, generationOf(key) + 1);
  entries.delete(key);
  inFlight.delete(key);
}

/** Test seam. Never called from production code. */
export function clearImmichAssetCache(): void {
  entries.clear();
  inFlight.clear();
  generations.clear();
}

/** Test seam. Never called from production code. Returns the promise in inFlight for a key, or undefined. */
export function getInFlightPromise(userId: string, albumId: string): Promise<ImmichAsset[]> | undefined {
  const key = keyOf(userId, albumId);
  return inFlight.get(key);
}

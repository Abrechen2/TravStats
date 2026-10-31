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
/**
 * The most albums held at once (forgejo#358). A listing is 1-2 MB at 5k assets,
 * and an entry used to stay until restart unless the same album was asked for
 * again. The oldest entry goes first.
 */
export const ASSET_CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  expiresAt: number;
  assets: ImmichAsset[];
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ImmichAsset[]>>();

// Invalidation clock. `invalidateAlbumAssets` stamps the key with a rising
// number; a load remembers the clock when it STARTED and skips writing its
// (now stale) result if the key was stamped after that. A stamp only matters
// while a load that started before it is still running, so the map is emptied
// whenever no load is in flight instead of growing with every album ever seen.
let clock = 0;
let activeLoads = 0;
const invalidatedAt = new Map<string, number>();

const keyOf = (userId: string, albumId: string): string => JSON.stringify([userId, albumId]);

/** Store an entry; expired ones and, past the cap, the oldest ones are dropped. */
function remember(key: string, assets: ImmichAsset[]): void {
  const now = Date.now();
  for (const [k, e] of entries) if (e.expiresAt <= now) entries.delete(k);
  entries.delete(key);
  entries.set(key, { assets, expiresAt: now + ASSET_CACHE_TTL_MS });
  while (entries.size > ASSET_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export async function getCachedAlbumAssets(
  userId: string,
  albumId: string,
  load: () => Promise<ImmichAsset[]>
): Promise<ImmichAsset[]> {
  const key = keyOf(userId, albumId);

  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.assets;
  }
  if (cached) entries.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const startedAt = clock;
  activeLoads++;

  // A failed load must not be cached — `finally` clears the in-flight slot so
  // the next caller retries upstream instead of adopting a rejected promise.
  const promise: Promise<ImmichAsset[]> = load()
    .then((assets) => {
      // Only write back if no invalidation happened while this load was in
      // flight. Otherwise we'd resurrect data fetched before the
      // invalidation, silently serving it stale for up to a full TTL
      // window — the caller still gets `assets` below, only the cache
      // write is suppressed.
      if ((invalidatedAt.get(key) ?? 0) <= startedAt) {
        remember(key, assets);
      }
      return assets;
    })
    .finally(() => {
      activeLoads--;
      if (activeLoads === 0) invalidatedAt.clear();
      // Only retract our own registration. An invalidation may have replaced it
      // with a newer load, and deleting by key alone would orphan that load's
      // in-flight entry and cause a redundant upstream call.
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * What the cache already holds for a key — a fresh entry, or the load already
 * in flight — without ever starting a load. For callers that must not cause an
 * upstream request themselves (a thumbnail proof); null means "nothing held".
 */
export function peekCachedAlbumAssets(
  userId: string,
  albumId: string
): Promise<ImmichAsset[]> | null {
  const key = keyOf(userId, albumId);
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.assets);
  if (cached) entries.delete(key);
  return inFlight.get(key) ?? null;
}

export function invalidateAlbumAssets(userId: string, albumId: string): void {
  const key = keyOf(userId, albumId);
  // Only worth remembering while a load that started earlier can still finish.
  if (activeLoads > 0) invalidatedAt.set(key, ++clock);
  entries.delete(key);
  inFlight.delete(key);
}

/** Test seam. Never called from production code. */
export function clearImmichAssetCache(): void {
  entries.clear();
  inFlight.clear();
  invalidatedAt.clear();
}

/** Test seam. Never called from production code. How many listings and invalidation stamps are held. */
export function immichAssetCacheSizes(): { entries: number; invalidations: number } {
  return { entries: entries.size, invalidations: invalidatedAt.size };
}

/** Test seam. Never called from production code. Returns the promise in inFlight for a key, or undefined. */
export function getInFlightPromise(
  userId: string,
  albumId: string
): Promise<ImmichAsset[]> | undefined {
  const key = keyOf(userId, albumId);
  return inFlight.get(key);
}

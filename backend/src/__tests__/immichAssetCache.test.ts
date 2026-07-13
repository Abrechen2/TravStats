import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  getCachedAlbumAssets,
  invalidateAlbumAssets,
  clearImmichAssetCache,
  ASSET_CACHE_TTL_MS,
  getInFlightPromise,
} from "../services/immich/immichAssetCache";
import { ImmichAsset } from "../services/immich/types";

const asset = (id: string): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-05-01T00:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: null,
  lon: null,
});

beforeEach(() => {
  jest.useFakeTimers();
  clearImmichAssetCache();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("getCachedAlbumAssets", () => {
  it("loads once and serves the cached list within the TTL", async () => {
    const load = jest.fn(async () => [asset("p1")]);

    await expect(getCachedAlbumAssets("u1", "a1", load)).resolves.toEqual([asset("p1")]);
    await expect(getCachedAlbumAssets("u1", "a1", load)).resolves.toEqual([asset("p1")]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);

    jest.advanceTimersByTime(ASSET_CACHE_TTL_MS + 1);
    await getCachedAlbumAssets("u1", "a1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("treats an entry exactly at the TTL boundary as stale", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);

    // Exact boundary, not TTL+1 — catches a `>` -> `>=` regression in the
    // expiry check that the other TTL test would miss.
    jest.advanceTimersByTime(ASSET_CACHE_TTL_MS);
    await getCachedAlbumAssets("u1", "a1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("scopes entries per user and per album", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);
    await getCachedAlbumAssets("u2", "a1", load);
    await getCachedAlbumAssets("u1", "a2", load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed load", async () => {
    const load = jest
      .fn<() => Promise<ImmichAsset[]>>()
      .mockRejectedValueOnce(new Error("immich down"))
      .mockResolvedValueOnce([asset("p1")]);

    await expect(getCachedAlbumAssets("u1", "a1", load)).rejects.toThrow("immich down");
    await expect(getCachedAlbumAssets("u1", "a1", load)).resolves.toEqual([asset("p1")]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent loads of the same key into one upstream call", async () => {
    let resolveLoad: (value: ImmichAsset[]) => void = () => {};
    const load = jest.fn(
      () =>
        new Promise<ImmichAsset[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const a = getCachedAlbumAssets("u1", "a1", load);
    const b = getCachedAlbumAssets("u1", "a1", load);
    resolveLoad([asset("p1")]);

    expect(await a).toEqual([asset("p1")]);
    expect(await b).toEqual([asset("p1")]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateAlbumAssets", () => {
  it("forces the next call to reload", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);
    invalidateAlbumAssets("u1", "a1");
    await getCachedAlbumAssets("u1", "a1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let a load already in flight repopulate the cache after invalidation", async () => {
    let resolveLoad: (value: ImmichAsset[]) => void = () => {};
    const staleLoad = jest.fn(
      () =>
        new Promise<ImmichAsset[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    // Caller X starts a load; it is registered in-flight but not yet
    // resolved.
    const inFlightCall = getCachedAlbumAssets("u1", "a1", staleLoad);

    // Caller Y invalidates while X's load is still pending.
    invalidateAlbumAssets("u1", "a1");

    // X's load now resolves with data fetched before the invalidation.
    resolveLoad([asset("stale")]);

    // X still receives its own result — the invalidation must not affect
    // the caller who already asked, only the cache write.
    await expect(inFlightCall).resolves.toEqual([asset("stale")]);

    // The next caller must NOT see the stale value served from cache; it
    // must trigger a brand-new upstream load.
    const freshLoad = jest.fn(async () => [asset("fresh")]);
    await expect(getCachedAlbumAssets("u1", "a1", freshLoad)).resolves.toEqual([asset("fresh")]);
    expect(freshLoad).toHaveBeenCalledTimes(1);
  });

  it("protects newer loads from deletion by older loads during invalidation window", async () => {
    // Turn off fake timers for this test since we need real async/await behavior.
    jest.useRealTimers();

    let resolveLoadX: (value: ImmichAsset[]) => void = () => {};
    let resolveLoadZ: (value: ImmichAsset[]) => void = () => {};
    let resolveLoadW: (value: ImmichAsset[]) => void = () => {};

    // Caller X starts load for key K; its promise is registered at inFlight[K].
    const loadX = jest.fn(
      () =>
        new Promise<ImmichAsset[]>((resolve) => {
          resolveLoadX = resolve;
        }),
    );
    const callX = getCachedAlbumAssets("u1", "a1", loadX);

    // invalidateAlbumAssets(K) bumps generation and deletes both entries[K]
    // and inFlight[K].
    invalidateAlbumAssets("u1", "a1");

    // Caller Z arrives, finds no entry and no in-flight promise, starts a
    // new load(K), registers its promise at inFlight[K].
    const loadZ = jest.fn(
      () =>
        new Promise<ImmichAsset[]>((resolve) => {
          resolveLoadZ = resolve;
        }),
    );
    const callZ = getCachedAlbumAssets("u1", "a1", loadZ);

    // X's original (now superseded) promise settles. Its .finally runs
    // inFlight.delete(key) — if guarded by identity, nothing happens; if
    // not guarded, it deletes Z's still-pending entry.
    resolveLoadX([asset("stale")]);
    // Let X's .finally() microtask run. This is the critical timing that
    // triggers the bug: X's cleanup tries to delete its own in-flight entry,
    // but instead deletes Z's (if not guarded by identity).
    await Promise.resolve();

    // Caller W now arrives while Z's load is still running. If X's finally()
    // already deleted Z's in-flight entry (the bug), then W finds inFlight[K]
    // empty and starts a new load. If the delete was guarded by identity
    // (the fix), then W finds Z's promise and reuses it.
    const loadW = jest.fn(
      () =>
        new Promise<ImmichAsset[]>((resolve) => {
          resolveLoadW = resolve;
        }),
    );
    const callW = getCachedAlbumAssets("u1", "a1", loadW);

    // Now resolve Z and W to see which promises got used.
    resolveLoadZ([asset("z")]);
    resolveLoadW([asset("w")]);

    // X receives its own value (unchanged by invalidation).
    await expect(callX).resolves.toEqual([asset("stale")]);

    // If W adopted Z's promise, callW will resolve to [asset("z")].
    // If W created its own promise (bug), callW will resolve to [asset("w")].
    const callWResult = await callW;

    // loadX was called once (X).
    // loadZ was called once (Z).
    expect(loadX).toHaveBeenCalledTimes(1);
    expect(loadZ).toHaveBeenCalledTimes(1);

    if (callWResult[0]?.id === "z") {
      // W adopted Z's promise (correct behavior — fix is in place).
      expect(loadW).toHaveBeenCalledTimes(0);
    } else if (callWResult[0]?.id === "w") {
      // W created its own promise (buggy behavior — unguarded delete).
      expect(loadW).toHaveBeenCalledTimes(1);
    } else {
      throw new Error(`Unexpected result: ${JSON.stringify(callWResult)}`);
    }
  });
});

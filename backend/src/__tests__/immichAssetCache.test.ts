import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  getCachedAlbumAssets,
  invalidateAlbumAssets,
  clearImmichAssetCache,
  ASSET_CACHE_TTL_MS,
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
});

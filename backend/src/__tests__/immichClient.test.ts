/**
 * The Immich client is the only place that knows Immich's REST shape, so these
 * tests pin that shape: paths, the x-api-key header, search-based album asset
 * listing with pagination, and the error taxonomy the UI depends on.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { createImmichClient } from "../services/immich/immichClient";
import { ImmichError, ImmichConnection } from "../services/immich/types";
import logger from "../utils/logger";

const mockedLogger = logger as jest.Mocked<typeof logger>;

const CONN: ImmichConnection = {
  baseUrl: "https://immich.lan",
  apiKey: "secret-key",
  source: "user",
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("getServerVersion", () => {
  it("GETs /api/server/version and formats it", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { major: 1, minor: 138, patch: 2 } });
    const version = await createImmichClient(CONN).getServerVersion();
    expect(version).toBe("1.138.2");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/server/version",
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } }),
    );
  });

  it("maps a connection refusal to kind=unreachable", async () => {
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, code: "ECONNREFUSED" });
    await expect(createImmichClient(CONN).getServerVersion()).rejects.toMatchObject({
      name: "ImmichError",
      kind: "unreachable",
    });
  });

  it("maps a non-JSON body to kind=protocol", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: "<html>login</html>" });
    await expect(createImmichClient(CONN).getServerVersion()).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("logs the original error when a non-axios failure is thrown", async () => {
    const original = new Error("socket hang up, no idea why");
    mockedAxios.get.mockRejectedValueOnce(original);

    await expect(createImmichClient(CONN).getServerVersion()).rejects.toMatchObject({
      kind: "protocol",
    });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "immich_client_unexpected_error",
        error: original,
        // The log payload names the failing endpoint under `endpoint`, not the
        // confusing `context: { context }` doubling.
        context: { endpoint: "server/version" },
      }),
    );
  });
});

describe("whoami", () => {
  it("maps 401 to kind=auth", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: {} },
    });
    await expect(createImmichClient(CONN).whoami()).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });
  });

  it("returns the identity on success", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: "u1", email: "a@b.c", name: "Ann", avatarColor: "red" },
    });
    await expect(createImmichClient(CONN).whoami()).resolves.toEqual({
      id: "u1",
      email: "a@b.c",
      name: "Ann",
    });
  });
});

describe("listAlbums", () => {
  it("GETs /api/albums and maps albumThumbnailAssetId to thumbnailAssetId", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: "a1", albumName: "Rome", assetCount: 12, albumThumbnailAssetId: "t1" },
        { id: "a2", albumName: "Oslo", assetCount: 0, albumThumbnailAssetId: null },
      ],
    });
    const albums = await createImmichClient(CONN).listAlbums();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/albums",
      expect.anything(),
    );
    expect(albums).toEqual([
      { id: "a1", albumName: "Rome", assetCount: 12, thumbnailAssetId: "t1" },
      { id: "a2", albumName: "Oslo", assetCount: 0, thumbnailAssetId: null },
    ]);
  });

  it("rejects a non-array body as kind=protocol", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { albums: [] } });
    await expect(createImmichClient(CONN).listAlbums()).rejects.toMatchObject({ kind: "protocol" });
  });

  it("drops an album with a missing or non-string id (consistent with mapAsset)", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: "a1", albumName: "Rome", assetCount: 1, albumThumbnailAssetId: null },
        { albumName: "NoId", assetCount: 2 },
        { id: 123, albumName: "NumericId", assetCount: 3 },
        { id: "", albumName: "EmptyId", assetCount: 4 },
      ],
    });
    const albums = await createImmichClient(CONN).listAlbums();
    expect(albums.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("listAlbumAssets", () => {
  const asset = (id: string) => ({
    id,
    type: "IMAGE",
    fileCreatedAt: "2026-05-01T10:00:00.000Z",
    originalFileName: `${id}.jpg`,
    originalMimeType: "image/jpeg",
    exifInfo: { latitude: 41.9, longitude: 12.5, fileSizeInByte: 2048 },
  });

  it("POSTs /api/search/metadata with albumIds + withExif and follows pagination", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { assets: { items: [asset("p1")], nextPage: "2" } } })
      .mockResolvedValueOnce({ data: { assets: { items: [asset("p2")], nextPage: null } } });

    const assets = await createImmichClient(CONN).listAlbumAssets("album-1");

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      1,
      "https://immich.lan/api/search/metadata",
      { albumIds: ["album-1"], withExif: true, page: 1, size: 1000 },
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } }),
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://immich.lan/api/search/metadata",
      { albumIds: ["album-1"], withExif: true, page: 2, size: 1000 },
      expect.anything(),
    );
    expect(assets.map((a) => a.id)).toEqual(["p1", "p2"]);
  });

  it("maps exifInfo onto flat sizeBytes/lat/lon and tolerates a missing exifInfo", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        assets: {
          items: [
            asset("p1"),
            { ...asset("p2"), exifInfo: undefined },
            { ...asset("p3"), exifInfo: { latitude: null, longitude: null, fileSizeInByte: null } },
          ],
          nextPage: null,
        },
      },
    });
    const [p1, p2, p3] = await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(p1).toEqual({
      id: "p1",
      type: "IMAGE",
      fileCreatedAt: "2026-05-01T10:00:00.000Z",
      originalFileName: "p1.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      lat: 41.9,
      lon: 12.5,
    });
    expect(p2).toMatchObject({ sizeBytes: null, lat: null, lon: null });
    expect(p3).toMatchObject({ sizeBytes: null, lat: null, lon: null });
  });

  it("stops after MAX_PAGES to avoid an unbounded loop on a misbehaving server", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { assets: { items: [asset("x")], nextPage: "99" } },
    });
    const assets = await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(mockedAxios.post).toHaveBeenCalledTimes(50);
    expect(assets).toHaveLength(50);
  });

  it("logs a warning when MAX_PAGES truncates a large album", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { assets: { items: [asset("x")], nextPage: "99" } },
    });
    await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "immich_album_assets_truncated",
        context: expect.objectContaining({
          albumId: "album-1",
          maxPages: 50,
          collectedCount: 50,
        }),
      }),
    );
  });

  it("does not log a truncation warning for a normal 2-page album", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { assets: { items: [asset("p1")], nextPage: "2" } } })
      .mockResolvedValueOnce({ data: { assets: { items: [asset("p2")], nextPage: null } } });

    await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it("drops an asset with an empty-string id (would build /assets//original)", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        assets: {
          items: [asset("p1"), { ...asset("p2"), id: "" }],
          nextPage: null,
        },
      },
    });
    const assets = await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(assets.map((a) => a.id)).toEqual(["p1"]);
  });

  it("drops an asset with an unexpected type instead of coercing it to IMAGE", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        assets: {
          items: [asset("p1"), { ...asset("p2"), type: "AUDIO" }],
          nextPage: null,
        },
      },
    });
    const assets = await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(assets.map((a) => a.id)).toEqual(["p1"]);
  });

  it("maps 404 to kind=notFound (deleted album)", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: {} },
    });
    await expect(createImmichClient(CONN).listAlbumAssets("gone")).rejects.toMatchObject({
      kind: "notFound",
    });
  });
});

describe("fetchAssetStream", () => {
  it("uses /thumbnail?size= for thumbnail and preview", async () => {
    mockedAxios.get.mockResolvedValue({
      data: "stream",
      headers: { "content-type": "image/webp", "content-length": "123" },
    });
    const res = await createImmichClient(CONN).fetchAssetStream("asset-1", "preview");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/assets/asset-1/thumbnail?size=preview",
      expect.objectContaining({ responseType: "stream" }),
    );
    expect(res).toEqual({ stream: "stream", contentType: "image/webp", contentLength: 123 });
  });

  it("uses /original for the original (size=original is deprecated in v3)", async () => {
    mockedAxios.get.mockResolvedValue({
      data: "stream",
      headers: { "content-type": "image/jpeg" },
    });
    const res = await createImmichClient(CONN).fetchAssetStream("asset-1", "original");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/assets/asset-1/original",
      expect.objectContaining({ responseType: "stream" }),
    );
    expect(res.contentLength).toBeNull();
  });

  it("maps a 502 upstream to an ImmichError", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 502, data: {} },
    });
    await expect(
      createImmichClient(CONN).fetchAssetStream("asset-1", "thumbnail"),
    ).rejects.toBeInstanceOf(ImmichError);
  });
});

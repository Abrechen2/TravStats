/**
 * PhotoPrism adapter: the REST shape measured in
 * `docs/superpowers/specs/2026-11-20-photoprism-api-facts.md`, the token
 * handling, and every failure kind the UI distinguishes.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";
import { Readable } from "node:stream";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import logger from "../../../utils/logger";
import type { ImmichConnection } from "../../immich/types";
import {
  PHOTOPRISM_MIN_BUILD,
  clearPhotoprismTokenCache,
  createPhotoprismPhotoSource,
  photoprismBuild,
} from "../photoprismSource";

const mockedLogger = logger as jest.Mocked<typeof logger>;

const CONN: ImmichConnection = {
  baseUrl: "https://photos.example.com",
  apiKey: "app-password-1",
  source: "user",
  allowPrivate: true,
};
const PUBLIC_ONLY: ImmichConnection = { ...CONN, allowPrivate: false };

const HASH = "a".repeat(40);
const CONFIG = {
  version: "261029-963b58c50-Linux-AMD64-Plus",
  previewToken: "prevtok1",
  downloadToken: "1700000000.abc.def",
};

const axiosError = (status?: number, data?: unknown) => ({
  isAxiosError: true,
  ...(status === undefined ? { code: "ECONNREFUSED" } : { response: { status, data } }),
});

const mediaResponse = (contentType = "image/jpeg") => ({
  data: Readable.from([Buffer.from("x")]),
  headers: { "content-type": contentType, "content-length": "1" },
  request: undefined,
});

const calledUrls = (): string[] => mockedAxios.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  jest.resetAllMocks();
  clearPhotoprismTokenCache();
});

describe("photoprismBuild", () => {
  it("reads the build number of the version string", () => {
    expect(photoprismBuild("261029-963b58c50-Linux-AMD64-Plus")).toBe(261029);
    expect(photoprismBuild("not a version")).toBeNull();
  });
});

describe("test()", () => {
  it("reports the version after checking albums and tokens", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { version: CONFIG.version } })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: CONFIG });
    const result = await createPhotoprismPhotoSource(CONN).test();
    expect(result).toMatchObject({ success: true, details: { version: CONFIG.version } });
    expect(calledUrls()).toEqual([
      "https://photos.example.com/api/v1/config",
      "https://photos.example.com/api/v1/albums?type=album&count=1",
      "https://photos.example.com/api/v1/config",
    ]);
    // The anonymous version read carries no credential.
    expect((mockedAxios.get.mock.calls[0][1] as { headers: object }).headers).toEqual({});
  });

  it("answers protocol for a too-old PhotoPrism instead of failing later", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { version: `${PHOTOPRISM_MIN_BUILD - 1}-abc-Linux-AMD64-Plus` },
    });
    expect(await createPhotoprismPhotoSource(CONN).test()).toMatchObject({
      success: false,
      kind: "protocol",
    });
  });

  it("answers protocol when the host is something else entirely (no version)", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: "<html>hello</html>" });
    expect(await createPhotoprismPhotoSource(CONN).test()).toMatchObject({
      success: false,
      kind: "protocol",
    });
  });

  it("answers auth for a wrong app password (albums 401/403)", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { version: CONFIG.version } })
      .mockRejectedValueOnce(axiosError(401));
    expect(await createPhotoprismPhotoSource(CONN).test()).toMatchObject({
      success: false,
      kind: "auth",
    });
  });

  it("answers auth when the app password has no config scope (config carries no tokens)", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { version: CONFIG.version } })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { version: CONFIG.version } });
    const result = await createPhotoprismPhotoSource(CONN).test();
    expect(result).toMatchObject({ success: false, kind: "auth" });
    expect(result.message).toMatch(/config scope/);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: "photoprism_tokens_missing" })
    );
  });

  it("answers unreachable when the server does not answer", async () => {
    mockedAxios.get.mockRejectedValueOnce(axiosError());
    expect(await createPhotoprismPhotoSource(CONN).test()).toMatchObject({
      success: false,
      kind: "unreachable",
    });
  });
});

describe("egress (forgejo#411 rule)", () => {
  it("refuses a private target for an ordinary account before any request leaves", async () => {
    const lan: ImmichConnection = { ...PUBLIC_ONLY, baseUrl: "http://192.168.1.20:2342" };
    const result = await createPhotoprismPhotoSource(lan).test();
    expect(result).toMatchObject({ success: false, kind: "invalidUrl", code: "PRIVATE_TARGET" });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("lets an admin (allowPrivate) reach the same LAN host", async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });
    const lan: ImmichConnection = { ...CONN, baseUrl: "http://192.168.1.20:2342" };
    await createPhotoprismPhotoSource(lan).listAlbums();
    expect(calledUrls()[0]).toMatch(/^http:\/\/192\.168\.1\.20:2342\/api\/v1\/albums/);
  });

  it("never follows redirects, and pins DNS without an env proxy for an ordinary account", async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });
    await createPhotoprismPhotoSource(PUBLIC_ONLY).listAlbums();
    const config = mockedAxios.get.mock.calls[0][1] as Record<string, unknown>;
    expect(config.maxRedirects).toBe(0);
    expect(config.proxy).toBe(false);
    expect(config.httpAgent).toBeDefined();
    expect(config.httpsAgent).toBeDefined();
  });

  it("answers a redirect as protocol (a 3xx is a non-2xx for axios)", async () => {
    mockedAxios.get.mockRejectedValueOnce(axiosError(302));
    await expect(createPhotoprismPhotoSource(CONN).listAlbums()).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});

describe("listAlbums", () => {
  it("sends BOTH type and count (either alone is a 400/403) and maps the albums", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { UID: "as6sg6bxpogaaba8", Title: "Lisbon", PhotoCount: 3, Thumb: HASH },
        { UID: "bad uid!", Title: "dropped" },
        { UID: "as6sg6bxpogaaba9", Title: "No cover", PhotoCount: 0, Thumb: "" },
      ],
    });
    const albums = await createPhotoprismPhotoSource(CONN).listAlbums();
    expect(calledUrls()[0]).toBe(
      "https://photos.example.com/api/v1/albums?type=album&count=1000&offset=0"
    );
    expect((mockedAxios.get.mock.calls[0][1] as { headers: object }).headers).toEqual({
      Authorization: "Bearer app-password-1",
    });
    expect(albums).toEqual([
      { id: "as6sg6bxpogaaba8", albumName: "Lisbon", assetCount: 3, thumbnailAssetId: HASH },
      { id: "as6sg6bxpogaaba9", albumName: "No cover", assetCount: 0, thumbnailAssetId: null },
    ]);
  });

  it("pages through a big library by offset instead of silently stopping at one page", async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ UID: `album${from + i}`, Title: `A${from + i}` }));
    mockedAxios.get
      .mockResolvedValueOnce({ data: page(0, 1000) })
      .mockResolvedValueOnce({ data: page(1000, 3) });
    const albums = await createPhotoprismPhotoSource(CONN).listAlbums();
    expect(albums).toHaveLength(1003);
    expect(calledUrls()[1]).toContain("offset=1000");
  });

  it("fails loudly (protocol) instead of returning a prefix when the library never ends", async () => {
    mockedAxios.get.mockResolvedValue({
      data: Array.from({ length: 1000 }, (_, i) => ({ UID: `album${i}`, Title: "x" })),
    });
    await expect(createPhotoprismPhotoSource(CONN).listAlbums()).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("maps a 403 (permission denied) to auth", async () => {
    mockedAxios.get.mockRejectedValueOnce(axiosError(403));
    await expect(createPhotoprismPhotoSource(CONN).listAlbums()).rejects.toMatchObject({
      kind: "auth",
    });
  });
});

describe("listAlbumAssets", () => {
  const photo = (over: Record<string, unknown>) => ({
    UID: "p1",
    Hash: HASH,
    Type: "image",
    TakenAt: "2024-05-01T10:00:00Z",
    TakenSrc: "meta",
    Lat: 38.7,
    Lng: -9.1,
    FileName: "2024/05/IMG_1.jpg",
    ...over,
  });

  it("asks for a page oldest first and keeps paging while pages are full", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [photo({})] });
    const page = await createPhotoprismPhotoSource(CONN).listAlbumAssets("as6sg6bxpogaaba8", 2);
    expect(calledUrls()[0]).toBe(
      "https://photos.example.com/api/v1/photos?s=as6sg6bxpogaaba8&count=500&offset=1000&order=oldest"
    );
    expect(page.nextPage).toBeNull();
    expect(page.assets[0]).toMatchObject({
      id: HASH,
      type: "IMAGE",
      fileCreatedAt: "2024-05-01T10:00:00.000Z",
      originalFileName: "IMG_1.jpg",
      lat: 38.7,
      lon: -9.1,
      sizeBytes: null,
    });

    const full = Array.from({ length: 500 }, (_, i) =>
      photo({ Hash: i.toString(16).padStart(40, "0") })
    );
    mockedAxios.get.mockResolvedValueOnce({ data: full });
    expect(
      (await createPhotoprismPhotoSource(CONN).listAlbumAssets("as6sg6bxpogaaba8", 0)).nextPage
    ).toBe(1);
  });

  it("reads Lat/Lng 0/0 as no position, not as a point in the Gulf of Guinea", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [photo({ Lat: 0, Lng: 0 })] });
    const [asset] = (await createPhotoprismPhotoSource(CONN).listAlbumAssets("as6sg6bxpogaaba8", 0))
      .assets;
    expect(asset.lat).toBeNull();
    expect(asset.lon).toBeNull();
  });

  it("reports no capture time (null, not 1970) when TakenSrc is empty, i.e. only a file modification time", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [photo({ TakenSrc: "" })] });
    const [asset] = (await createPhotoprismPhotoSource(CONN).listAlbumAssets("as6sg6bxpogaaba8", 0))
      .assets;
    expect(asset.fileCreatedAt).toBeNull();
  });

  it("drops entries without a usable hash or of a non-photo type", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [photo({ Hash: "" }), photo({ Type: "document" }), photo({ Type: "video" })],
    });
    const { assets } = await createPhotoprismPhotoSource(CONN).listAlbumAssets(
      "as6sg6bxpogaaba8",
      0
    );
    expect(assets.map((a) => a.type)).toEqual(["VIDEO"]);
  });

  it("refuses an album id that is not a UID before building a URL", async () => {
    await expect(
      createPhotoprismPhotoSource(CONN).listAlbumAssets("../config", 0)
    ).rejects.toMatchObject({ kind: "notFound" });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("answers protocol for a non-list payload", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { error: "x" } });
    await expect(
      createPhotoprismPhotoSource(CONN).listAlbumAssets("as6sg6bxpogaaba8", 0)
    ).rejects.toMatchObject({ kind: "protocol" });
  });
});

describe("streams", () => {
  it("builds /t/<hash>/<previewToken>/<size> from the tokens of /config and caches them", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: CONFIG }).mockResolvedValue(mediaResponse());
    const source = createPhotoprismPhotoSource(CONN);
    await source.streamThumbnail(HASH, "thumbnail");
    await source.streamThumbnail(HASH, "preview");
    expect(calledUrls()).toEqual([
      "https://photos.example.com/api/v1/config",
      `https://photos.example.com/api/v1/t/${HASH}/prevtok1/tile_500`,
      `https://photos.example.com/api/v1/t/${HASH}/prevtok1/fit_1280`,
    ]);
  });

  it("builds /dl/<hash>?t=<downloadToken> for the original", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: CONFIG })
      .mockResolvedValueOnce(mediaResponse("image/jpeg"));
    await createPhotoprismPhotoSource(CONN).streamOriginal(HASH);
    expect(calledUrls()[1]).toBe(
      `https://photos.example.com/api/v1/dl/${HASH}?t=${encodeURIComponent(CONFIG.downloadToken)}`
    );
  });

  it("refreshes the tokens once after a 403 and then succeeds", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: CONFIG })
      .mockRejectedValueOnce(axiosError(403, Readable.from(["<svg/>"])))
      .mockResolvedValueOnce({ data: { ...CONFIG, previewToken: "prevtok2" } })
      .mockResolvedValueOnce(mediaResponse());
    await createPhotoprismPhotoSource(CONN).streamThumbnail(HASH, "thumbnail");
    expect(calledUrls()[3]).toContain("/prevtok2/");
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: "photoprism_token_refresh" })
    );
  });

  it("shares one token fetch between concurrent downloads, cold and after a 401 (an import runs ten at once)", async () => {
    let configCalls = 0;
    let rejected = 0;
    mockedAxios.get.mockImplementation((async (url: unknown) => {
      if (String(url).endsWith("/config")) {
        configCalls += 1;
        return { data: { ...CONFIG, downloadToken: `dt${configCalls}` } };
      }
      // The first token is stale for every download; the refreshed one works.
      if (String(url).includes("t=dt1")) {
        rejected += 1;
        throw axiosError(401);
      }
      return mediaResponse();
    }) as never);
    const source = createPhotoprismPhotoSource(CONN);

    await Promise.all([
      source.streamOriginal(HASH),
      source.streamOriginal(HASH),
      source.streamOriginal(HASH),
    ]);

    expect(rejected).toBe(3);
    // One cold fetch and one refresh for all three — not three of each.
    expect(configCalls).toBe(2);
  });

  it("answers auth (and does not loop) when the 403 persists after a refresh", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: CONFIG })
      .mockRejectedValueOnce(axiosError(403))
      .mockResolvedValueOnce({ data: CONFIG })
      .mockRejectedValueOnce(axiosError(403));
    await expect(
      createPhotoprismPhotoSource(CONN).streamThumbnail(HASH, "thumbnail")
    ).rejects.toMatchObject({
      kind: "auth",
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(4);
  });

  it("never forwards an SVG body, even with a 200", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: CONFIG })
      .mockResolvedValueOnce(mediaResponse("image/svg+xml"));
    await expect(
      createPhotoprismPhotoSource(CONN).streamThumbnail(HASH, "thumbnail")
    ).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("refuses non-media bodies", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: CONFIG })
      .mockResolvedValueOnce(mediaResponse("text/html"));
    await expect(createPhotoprismPhotoSource(CONN).streamOriginal(HASH)).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("never lets an asset id that is not a hash reach a URL", async () => {
    mockedAxios.get.mockResolvedValue({ data: CONFIG });
    await expect(
      createPhotoprismPhotoSource(CONN).streamThumbnail("../../etc/passwd", "thumbnail")
    ).rejects.toMatchObject({ kind: "notFound" });
    expect(calledUrls().every((u) => !u.includes("passwd"))).toBe(true);
  });

  it("says the app password lacks the config scope when /config carries no tokens", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { version: CONFIG.version } });
    await expect(
      createPhotoprismPhotoSource(CONN).streamThumbnail(HASH, "thumbnail")
    ).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("does not put the app password or a token into an error message", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: CONFIG }).mockRejectedValueOnce(axiosError(500));
    const error = await createPhotoprismPhotoSource(CONN)
      .streamThumbnail(HASH, "thumbnail")
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain("prevtok1");
    expect((error as Error).message).not.toContain("app-password-1");
  });
});

describe("searchAssetsByTime", () => {
  const photo = (hash: string, over: Record<string, unknown> = {}) => ({
    Hash: hash,
    Type: "image",
    TakenAt: "2026-10-10T12:05:00Z",
    TakenSrc: "meta",
    FileName: "a.jpg",
    ...over,
  });
  const range = {
    takenAfter: new Date("2026-10-10T11:00:00Z"),
    takenBefore: new Date("2026-10-10T14:59:59Z"),
  };

  it("asks /photos for the days around the range, oldest first, and keeps the capture time", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [photo(HASH), photo("b".repeat(40), { TakenSrc: "" })],
    });
    const found = await createPhotoprismPhotoSource(CONN).searchAssetsByTime(range);
    expect(calledUrls()[0]).toBe(
      "https://photos.example.com/api/v1/photos?after=2026-10-09&before=2026-10-11&count=500&offset=0&order=oldest"
    );
    expect(found.truncated).toBe(false);
    expect(found.assets.map((a) => a.fileCreatedAt)).toEqual(["2026-10-10T12:05:00.000Z", null]);
  });

  it("reads further pages while they are full, and says when the page bound ran out", async () => {
    const full = (n: number) =>
      Array.from({ length: 500 }, (_, i) => photo((n * 500 + i).toString(16).padStart(40, "0")));
    mockedAxios.get.mockResolvedValueOnce({ data: full(0) }).mockResolvedValueOnce({ data: [] });
    const done = await createPhotoprismPhotoSource(CONN).searchAssetsByTime(range);
    expect(done).toMatchObject({ truncated: false });
    expect(done.assets).toHaveLength(500);
    expect(calledUrls()[1]).toContain("offset=500");

    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({ data: full(1) });
    const bounded = await createPhotoprismPhotoSource(CONN).searchAssetsByTime(range);
    expect(bounded.truncated).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledTimes(10);
  });

  it("a rejected app password is its own kind, not an empty list", async () => {
    mockedAxios.get.mockRejectedValueOnce(axiosError(401));
    await expect(createPhotoprismPhotoSource(CONN).searchAssetsByTime(range)).rejects.toMatchObject(
      { kind: "auth" }
    );
  });
});

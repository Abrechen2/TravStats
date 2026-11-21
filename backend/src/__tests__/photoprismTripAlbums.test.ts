/**
 * Linking a PhotoPrism album to a trip and streaming its images through the
 * ownership-checked proxy: the provider travels with the link, never mixes
 * with Immich's ids, and every failure answers with the fixed kinds.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Readable } from "stream";

jest.mock("../routes/trips", () => ({ resolveTrip: jest.fn(async () => ({ id: "trip-1" })) }));

const findManyLinks = jest.fn<(args: unknown) => Promise<unknown[]>>();
const findFirstLink = jest.fn<(args: unknown) => Promise<unknown>>();
const createManyLinks = jest.fn<(args: unknown) => Promise<{ count: number }>>();
jest.mock("../db", () => ({
  prisma: {
    immichImportJob: { upsert: jest.fn() },
    tripImmichAlbum: {
      findMany: findManyLinks,
      findFirst: findFirstLink,
      createMany: createManyLinks,
    },
  },
}));

const listAlbums = jest.fn<() => Promise<unknown[]>>();
const listAlbumAssets = jest.fn<(albumId: string, page: number) => Promise<unknown>>();
const streamThumbnail = jest.fn<(id: string, size: string) => Promise<unknown>>();
const createPhotoSource = jest.fn((_kind: string, _conn: unknown) => ({
  kind: _kind,
  listAlbums,
  listAlbumAssets,
  streamThumbnail,
  streamOriginal: streamThumbnail,
}));
jest.mock("../services/photoSource", () => ({
  ...jest.requireActual<object>("../services/photoSource"),
  createPhotoSource,
}));

const getPhotoSourceConnection = jest.fn<(kind: string, userId: string) => Promise<unknown>>();
jest.mock("../services/photoSource/connection", () => ({
  ...jest.requireActual<object>("../services/photoSource/connection"),
  getPhotoSourceConnection,
}));
jest.mock("../services/immich/immichResolver", () => ({
  getImmichConnection: jest.fn(),
  getImmichDefaultMode: jest.fn(async () => "link"),
}));
const startAlbumImport = jest.fn();
const estimateAlbumImport = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const isImportInFlight = jest.fn<(linkId: string) => boolean>();
jest.mock("../services/immich/immichImport", () => ({
  startAlbumImport,
  deleteImportedPhotoFiles: jest.fn(),
  estimateAlbumImport,
  getImportJob: jest.fn(),
  isImportInFlight,
}));
jest.mock("../middleware/rateLimit", () => ({
  immichImportLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
  immichProxyLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../middleware/auth", () => {
  const actual = jest.requireActual<typeof import("../middleware/auth")>("../middleware/auth");
  return {
    ...actual,
    authenticate: (req: unknown, _res: unknown, next: () => void) => {
      (req as express.Request & { userId?: string }).userId = "u1";
      next();
    },
  };
});

import { clearImmichAssetCache } from "../services/immich/immichAssetCache";
import { ImmichError } from "../services/immich/types";
import tripAlbumsRouter from "../routes/immich/tripAlbums";
import assetProxyRouter from "../routes/immich/assetProxy";
import { errorHandler } from "../middleware/errorHandler";

const app = (): express.Express => {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", tripAlbumsRouter, assetProxyRouter);
  a.use(errorHandler);
  return a;
};

const CONN = {
  baseUrl: "https://photos.example.com",
  apiKey: "pw",
  source: "user",
  allowPrivate: false,
};
const HASH = "b".repeat(40);
const photoAsset = (id: string) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2024-05-01T00:00:00.000Z",
  originalFileName: "x.jpg",
  mimeType: "application/octet-stream",
  sizeBytes: null,
  lat: null,
  lon: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getPhotoSourceConnection.mockResolvedValue(CONN);
  findManyLinks.mockResolvedValue([]);
  createManyLinks.mockResolvedValue({ count: 1 });
  listAlbumAssets.mockResolvedValue({
    assets: [photoAsset(HASH)],
    nextPage: null,
    truncated: false,
  });
});

describe("album picker", () => {
  it("lists the albums of the requested source and marks only links of that source", async () => {
    listAlbums.mockResolvedValue([
      { id: "x1", albumName: "Lisbon", assetCount: 2, thumbnailAssetId: HASH },
    ]);
    findManyLinks.mockResolvedValue([{ id: "link-9", immichAlbumId: "x1" }]);

    const res = await request(app()).get("/api/v1/trips/trip-1/immich/albums?provider=photoprism");

    expect(res.status).toBe(200);
    expect(getPhotoSourceConnection).toHaveBeenCalledWith("photoprism", "u1");
    expect(createPhotoSource).toHaveBeenCalledWith("photoprism", CONN);
    expect(findManyLinks).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tripId: "trip-1", provider: "photoprism" } })
    );
    expect(res.body.albums[0]).toMatchObject({ id: "x1", linked: true, linkId: "link-9" });
  });

  it("answers 409 notConfigured when PhotoPrism is not connected", async () => {
    getPhotoSourceConnection.mockResolvedValue(null);
    const res = await request(app()).get("/api/v1/trips/trip-1/immich/albums?provider=photoprism");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
  });

  it("surfaces an upstream auth failure as 502 with the fixed kind", async () => {
    listAlbums.mockRejectedValue(new ImmichError("auth", "PhotoPrism rejected the app password"));
    const res = await request(app()).get("/api/v1/trips/trip-1/immich/albums?provider=photoprism");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("auth");
  });

  it("rejects an unknown provider", async () => {
    const res = await request(app()).get("/api/v1/trips/trip-1/immich/albums?provider=flickr");
    expect(res.status).toBe(400);
  });
});

describe("POST link", () => {
  const post = (albums: unknown[]) =>
    request(app()).post("/api/v1/trips/trip-1/immich/albums").send({ albums });

  it("stores the provider with the link", async () => {
    listAlbums.mockResolvedValue([
      { id: "x1", albumName: "Lisbon", assetCount: 2, thumbnailAssetId: HASH },
    ]);
    findManyLinks.mockResolvedValue([]);
    const res = await post([{ immichAlbumId: "x1", mode: "link", provider: "photoprism" }]);
    expect(res.status).toBe(201);
    expect(createManyLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ provider: "photoprism", immichAlbumId: "x1" })],
      })
    );
  });

  it("accepts import mode for PhotoPrism: stores the link and starts the import job (phase B3)", async () => {
    listAlbums.mockResolvedValue([
      { id: "x1", albumName: "Lisbon", assetCount: 2, thumbnailAssetId: HASH },
    ]);
    findManyLinks.mockResolvedValue([
      { id: "link-7", provider: "photoprism", immichAlbumId: "x1", mode: "import", sortIdx: 0 },
    ]);
    const res = await post([{ immichAlbumId: "x1", mode: "import", provider: "photoprism" }]);
    expect(res.status).toBe(201);
    expect(createManyLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ provider: "photoprism", mode: "import" })],
      })
    );
    expect(startAlbumImport).toHaveBeenCalledWith("u1", "link-7");
  });

  it("refuses to mix sources in one request", async () => {
    const res = await post([
      { immichAlbumId: "x1", mode: "link", provider: "photoprism" },
      { immichAlbumId: "y1", mode: "link", provider: "immich" },
    ]);
    expect(res.status).toBe(400);
    expect(createManyLinks).not.toHaveBeenCalled();
  });

  it("refuses an album the connected PhotoPrism does not expose", async () => {
    listAlbums.mockResolvedValue([]);
    const res = await post([{ immichAlbumId: "nope", mode: "link", provider: "photoprism" }]);
    expect(res.status).toBe(400);
    expect(createManyLinks).not.toHaveBeenCalled();
  });
});

describe("import mode routes for a PhotoPrism link", () => {
  const link = {
    id: "link-7",
    tripId: "trip-1",
    provider: "photoprism",
    immichAlbumId: "x1",
    mode: "import",
  };

  it("resync resolves the PhotoPrism connection, not the Immich one, and fires the import", async () => {
    findFirstLink.mockResolvedValue(link);
    isImportInFlight.mockReturnValue(false);
    const res = await request(app()).post("/api/v1/trips/trip-1/immich/albums/link-7/resync");
    expect(res.status).toBe(202);
    expect(getPhotoSourceConnection).toHaveBeenCalledWith("photoprism", "u1");
    expect(startAlbumImport).toHaveBeenCalledWith("u1", "link-7");
  });

  it("resync answers 409 notConfigured (naming PhotoPrism) when its connection is gone", async () => {
    findFirstLink.mockResolvedValue(link);
    isImportInFlight.mockReturnValue(false);
    getPhotoSourceConnection.mockResolvedValue(null);
    const res = await request(app()).post("/api/v1/trips/trip-1/immich/albums/link-7/resync");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
    expect(res.body.message).toContain("PhotoPrism");
    expect(startAlbumImport).not.toHaveBeenCalled();
  });

  it("resync leaves a live run alone (in-flight rule as for Immich)", async () => {
    findFirstLink.mockResolvedValue(link);
    isImportInFlight.mockReturnValue(true);
    const res = await request(app()).post("/api/v1/trips/trip-1/immich/albums/link-7/resync");
    expect(res.status).toBe(202);
    expect(res.body.job.status).toBe("running");
    expect(startAlbumImport).not.toHaveBeenCalled();
  });

  it("the import estimate is asked of the requested source", async () => {
    estimateAlbumImport.mockResolvedValue({ assetCount: 3, totalBytes: 30 });
    const res = await request(app()).get(
      "/api/v1/trips/trip-1/immich/estimate?albumId=x1&provider=photoprism"
    );
    expect(res.status).toBe(200);
    expect(estimateAlbumImport).toHaveBeenCalledWith("u1", "x1", "photoprism");
  });
});

describe("asset proxy for a PhotoPrism link", () => {
  const url = (id: string, size = "preview") =>
    `/api/v1/trips/trip-1/immich/albums/link-1/assets/${id}/file?size=${size}`;
  beforeEach(() => {
    findFirstLink.mockResolvedValue({ immichAlbumId: "x1", provider: "photoprism" });
    streamThumbnail.mockImplementation(async () => ({
      stream: Readable.from([Buffer.from("jpg")]),
      contentType: "image/jpeg",
      contentLength: 3,
    }));
  });

  it("streams a member hash with private caching, through the PhotoPrism source", async () => {
    const res = await request(app()).get(url(HASH));
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=86400, immutable");
    expect(getPhotoSourceConnection).toHaveBeenCalledWith("photoprism", "u1");
    expect(streamThumbnail).toHaveBeenCalledWith(HASH, "preview");
  });

  it("refuses a hash that is not a member of the linked album", async () => {
    const res = await request(app()).get(url("c".repeat(40)));
    expect(res.status).toBe(404);
    expect(streamThumbnail).not.toHaveBeenCalled();
  });

  it("refuses an id that is neither a UUID nor a hash before any upstream call", async () => {
    const res = await request(app()).get(url("..%2F..%2Fconfig"));
    expect(res.status).toBe(400);
    expect(createPhotoSource).not.toHaveBeenCalled();
  });

  it("paints the no-store placeholder (never the upstream body) when PhotoPrism answers a bad token", async () => {
    streamThumbnail.mockRejectedValue(
      new ImmichError("auth", "PhotoPrism rejected the app password")
    );
    const res = await request(app()).get(url(HASH));
    expect(res.status).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("does not serve one source's cached album listing to the other (same album id, other provider)", async () => {
    // First request fills the photoprism cache for album x1 ...
    await request(app()).get(url(HASH));
    // ... the same album id on an Immich link must list again, not reuse it.
    findFirstLink.mockResolvedValue({ immichAlbumId: "x1", provider: "immich" });
    getPhotoSourceConnection.mockResolvedValue(CONN);
    listAlbumAssets.mockResolvedValue({ assets: [], nextPage: null, truncated: false });
    const res = await request(app()).get(url(HASH));
    expect(res.status).toBe(404);
    expect(listAlbumAssets).toHaveBeenCalledTimes(2);
  });
});

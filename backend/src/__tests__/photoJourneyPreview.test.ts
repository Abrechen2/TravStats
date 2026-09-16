import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Readable } from "stream";

const findFirstJourney = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    tripImmichAlbum: { findFirst: jest.fn() },
    photoJourney: { findFirst: findFirstJourney },
  },
}));

jest.mock("../routes/trips", () => ({ resolveTrip: jest.fn() }));

const fetchAssetStream = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets: jest.fn(), fetchAssetStream }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

jest.mock("../middleware/rateLimit", () => ({
  immichProxyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Same bypass the album-proxy suite uses: the mock performs the one side
// effect the real middleware has after verifying a token, so deleting
// `authenticate` from the route makes these fail rather than silently pass.
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

import assetProxyRouter from "../routes/immich/assetProxy";
import { errorHandler } from "../middleware/errorHandler";

/**
 * forgejo#94, point 2. A `PhotoJourney` row keeps `previewAssetIds` with the
 * note "the proxy already streams thumbnails". It did not: the album route
 * serves only an asset that is a MEMBER of a linked album, and a journey has
 * no album — so every id stored on those rows was unreachable and any client
 * drawing the strip got a 404.
 *
 * The property these tests are really about: THE ROW IS THE GRANT. The asset
 * id comes from the stored array at the requested index and never from the
 * request, which is what stops owning one journey from becoming a reader for
 * the whole library.
 */
describe("GET /photo-journeys/:id/preview/:index/file", () => {
  const ASSET = "11111111-1111-4111-8111-111111111111";

  const app = (): express.Express => {
    const instance = express();
    instance.use("/api/v1", assetProxyRouter);
    instance.use(errorHandler);
    return instance;
  };

  // `encodeURIComponent` the index: a literal "../.." segment is collapsed by
  // the HTTP client's own URL normalisation before the request is sent, so the
  // route would never see it and the test would assert on Express's built-in
  // 404 instead of the validation gate. The album-proxy suite makes the same
  // point about its asset id.
  const url = (index: string | number, size?: string): string =>
    `/api/v1/photo-journeys/j1/preview/${encodeURIComponent(String(index))}/file${size ? `?size=${size}` : ""}`;

  beforeEach(() => {
    jest.clearAllMocks();
    getImmichConnection.mockResolvedValue({ baseUrl: "http://immich.local", apiKey: "k" } as never);
    findFirstJourney.mockResolvedValue({ previewAssetIds: [ASSET] } as never);
    fetchAssetStream.mockResolvedValue({
      stream: Readable.from([Buffer.from("jpeg-bytes")]),
      contentType: "image/jpeg",
      contentLength: 10,
    } as never);
  });

  it("streams the id stored at that index", async () => {
    const res = await request(app()).get(url(0)).expect(200);

    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(fetchAssetStream).toHaveBeenCalledWith(ASSET, "thumbnail");
  });

  it("scopes the lookup to the caller, so another account's journey is a 404", async () => {
    await request(app()).get(url(0)).expect(200);

    // The ownership is IN the query, not checked after it: a journey belonging
    // to someone else must be indistinguishable from one that does not exist.
    expect(findFirstJourney).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "j1", userId: "u1" } })
    );
  });

  it("404s a journey the caller does not own", async () => {
    findFirstJourney.mockResolvedValue(null as never);
    await request(app()).get(url(0)).expect(404);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("404s an index past the end of the strip", async () => {
    await request(app()).get(url(5)).expect(404);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("refuses an index that is not one", async () => {
    await request(app()).get(url("../../secrets")).expect(400);
    expect(findFirstJourney).not.toHaveBeenCalled();
  });

  it("caches privately and answers a repeat view without touching Immich", async () => {
    const first = await request(app()).get(url(0)).expect(200);
    expect(first.headers["cache-control"]).toContain("private");

    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    fetchAssetStream.mockClear();
    await request(app()).get(url(0)).set("If-None-Match", etag).expect(304);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("says notConfigured rather than failing when there is no connection", async () => {
    getImmichConnection.mockResolvedValue(null as never);
    const res = await request(app()).get(url(0)).expect(409);
    expect(res.body.error).toBe("notConfigured");
  });
});

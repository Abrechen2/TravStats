import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Readable } from "stream";

const resolveTrip = jest.fn(async () => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findFirstLink = jest.fn();
jest.mock("../db", () => ({ prisma: { tripImmichAlbum: { findFirst: findFirstLink } } }));

const listAlbumAssets = jest.fn();
const fetchAssetStream = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets, fetchAssetStream }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

// The proxy must not be rate-limited in unit tests.
jest.mock("../middleware/rateLimit", () => ({
  immichProxyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Captured so the mid-pipe-error test can assert exactly one error was
// logged (a genuine upstream failure) and not a second one (which would
// indicate we tried to write a second status/body over an already-flushed
// response, i.e. an ERR_HTTP_HEADERS_SENT-class bug).
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// The route wires the real `authenticate` per-route (matching every other
// Immich sub-route). This suite has no signed cookie/bearer token, so bypass
// it here the same way `immichTripAlbums.test.ts` does. The mocked
// `authenticate` performs the key side effect of setting `userId` on the
// request, exactly as the real middleware does after token verification —
// no separate stub middleware injects it, so deleting `authenticate` from
// the route makes these tests fail rather than silently pass.
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
import assetProxyRouter from "../routes/immich/assetProxy";
import { errorHandler } from "../middleware/errorHandler";
import logger from "../utils/logger";

const mockedLogger = logger as jest.Mocked<typeof logger>;

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ASSET_ID = "22222222-2222-4222-8222-222222222222";

function makeApp(): express.Express {
  const app = express();
  app.use("/api/v1", assetProxyRouter);
  app.use(errorHandler);
  return app;
}

// `encodeURIComponent` the asset id: a literal "../../etc/passwd" segment gets
// collapsed by the HTTP client's own URL normalisation (WHATWG `URL` removes
// ".." path segments) before the request is ever sent, so the route would
// never see it and the test would accidentally assert on Express's built-in
// 404 instead of our Zod validation gate. Encoding preserves it as the raw
// `:assetId` param value the route actually has to reject.
const url = (assetId: string, size?: string): string =>
  `/api/v1/trips/trip-1/immich/albums/link-1/assets/${encodeURIComponent(assetId)}/file${size ? `?size=${size}` : ""}`;

const asset = (id: string) => ({
  id,
  type: "IMAGE" as const,
  fileCreatedAt: "2026-05-01T00:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: null,
  lon: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue({
    baseUrl: "https://immich.lan",
    apiKey: "k",
    source: "user",
  });
  findFirstLink.mockResolvedValue({
    id: "link-1",
    tripId: "trip-1",
    immichAlbumId: "a1",
    mode: "link",
  });
  listAlbumAssets.mockResolvedValue([asset(ASSET_ID)]);
  fetchAssetStream.mockImplementation(async () => ({
    stream: Readable.from([Buffer.from("image-bytes")]),
    contentType: "image/webp",
    contentLength: 11,
  }));
});

describe("asset proxy", () => {
  it("streams the thumbnail with immutable private cache headers and an ETag", async () => {
    const res = await request(makeApp()).get(url(ASSET_ID));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["cache-control"]).toBe("private, max-age=86400, immutable");
    expect(res.headers.etag).toBe(`"${ASSET_ID}-thumbnail"`);
    expect(res.body.toString()).toBe("image-bytes");
    expect(fetchAssetStream).toHaveBeenCalledWith(ASSET_ID, "thumbnail");
    // Pins the identity the ownership check actually ran with. Every
    // downstream mock in this suite ignores its arguments, so without this
    // assertion the harness would not notice if `authenticate` were removed
    // from the route (see the "authenticate guard regression" suite below).
    expect(resolveTrip).toHaveBeenCalledWith("u1", "trip-1");
  });

  it("defaults to size=thumbnail and honours an explicit preview", async () => {
    await request(makeApp()).get(url(ASSET_ID, "preview"));
    expect(fetchAssetStream).toHaveBeenCalledWith(ASSET_ID, "preview");
  });

  it("answers a matching If-None-Match with 304 without calling Immich", async () => {
    const res = await request(makeApp())
      .get(url(ASSET_ID))
      .set("If-None-Match", `"${ASSET_ID}-thumbnail"`);

    expect(res.status).toBe(304);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("refuses an asset that is not a member of the linked album", async () => {
    const res = await request(makeApp()).get(url(OTHER_ASSET_ID));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notFound");
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("404s with kind=notFound when the linked album row is gone", async () => {
    findFirstLink.mockResolvedValue(null);
    const res = await request(makeApp()).get(url(ASSET_ID));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notFound");
  });

  it("rejects a non-UUID asset id before any upstream call", async () => {
    const res = await request(makeApp()).get(url("../../etc/passwd"));
    expect(res.status).toBe(400);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("rejects an unknown size", async () => {
    const res = await request(makeApp()).get(url(ASSET_ID, "huge"));
    expect(res.status).toBe(400);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("404s when the caller does not own the trip", async () => {
    const { AppError } = jest.requireActual<typeof import("../middleware/errorHandler")>(
      "../middleware/errorHandler",
    );
    resolveTrip.mockRejectedValueOnce(new AppError("Trip not found", 404));
    const res = await request(makeApp()).get(url(ASSET_ID));
    expect(res.status).toBe(404);
  });

  it("returns a no-store placeholder PNG with 502 when Immich fails", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    fetchAssetStream.mockRejectedValue(new ImmichError("unreachable", "down"));

    const res = await request(makeApp()).get(url(ASSET_ID));

    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns 409 when no Immich connection is configured", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp()).get(url(ASSET_ID));
    expect(res.status).toBe(409);
  });

  it("destroys the response without a second header write when the upstream stream errors mid-pipe", async () => {
    // Pushes one chunk (so headers are flushed to the client, mirroring a
    // partially-downloaded image), then errors on the next pull instead of
    // ending cleanly — simulating the upstream connection dropping mid-body.
    class MidStreamFailure extends Readable {
      private pushedOnce = false;
      _read(): void {
        if (!this.pushedOnce) {
          this.pushedOnce = true;
          this.push(Buffer.from("partial-bytes"));
          return;
        }
        this.emit("error", Object.assign(new Error("upstream reset"), { code: "ECONNRESET" }));
      }
    }

    fetchAssetStream.mockResolvedValue({
      stream: new MidStreamFailure(),
      contentType: "image/webp",
      contentLength: null,
    });

    // The client side of this request may see a reset/aborted connection —
    // that is expected once headers + partial bytes are already on the
    // wire, so tolerate either a resolved or rejected supertest promise.
    await request(makeApp())
      .get(url(ASSET_ID))
      .catch(() => undefined);

    // Exactly one error log: the genuine upstream stream error. A second
    // call here would indicate the route tried to write another
    // status/body after headers were already sent (ERR_HTTP_HEADERS_SENT).
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "immich_proxy_stream_error" }),
    );
  });
});

describe("authenticate guard regression", () => {
  // Mirrors the equivalent suite in immichTripAlbums.test.ts. Every
  // downstream dependency in this file is a jest.fn() that resolves
  // regardless of its arguments, so without an explicit assertion on the
  // identity `resolveTrip` was called with, this suite would still pass in
  // full even if `authenticate` were deleted from the route's middleware
  // chain in assetProxy.ts (req.userId would silently become undefined).
  //
  // Manually verified: deleting `authenticate` from the route and re-running
  // this suite turns this test (and the happy-path assertion above) red;
  // restoring the file turns the suite green again.
  it("proves resolveTrip runs with the identity authenticate established, not an unauthenticated one", async () => {
    const res = await request(makeApp()).get(url(ASSET_ID));

    expect(resolveTrip).toHaveBeenCalledWith("u1", "trip-1");
    expect(res.status).toBe(200);
  });
});

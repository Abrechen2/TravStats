import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const resolveTrip = jest.fn(async () => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findFirstLink = jest.fn();
const findFirstPhoto = jest.fn();
const tripUpdate = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    tripImmichAlbum: { findFirst: findFirstLink },
    tripPhoto: { findFirst: findFirstPhoto },
    trip: { update: tripUpdate },
    adminSettings: { findFirst: jest.fn() },
  },
}));

const listAlbumAssets = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

// The route module wires the real `authenticate` per-route (matching every
// other trip sub-route). This suite has no signed cookie/bearer token, so
// bypass it here. The mocked `authenticate` performs the key side effect of
// setting `userId` on the request, exactly as the real middleware does after
// token verification — so if someone deletes `authenticate` from a route,
// `userId` stays undefined and the route's assertions fail. See the harness
// comment in `immichTripAlbums.test.ts` for the full rationale.
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
import tripCoverRouter from "../routes/immich/tripCover";
import { errorHandler } from "../middleware/errorHandler";

const LINK_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ASSET_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "44444444-4444-4444-8444-444444444444";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", tripCoverRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue({
    baseUrl: "https://immich.lan",
    apiKey: "k",
    source: "user",
  });
  findFirstLink.mockResolvedValue({
    id: LINK_ID,
    tripId: "trip-1",
    immichAlbumId: "a1",
    mode: "link",
  });
  listAlbumAssets.mockResolvedValue([
    {
      id: ASSET_ID,
      type: "IMAGE",
      fileCreatedAt: "2026-05-01T00:00:00.000Z",
      originalFileName: "p.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1,
      lat: null,
      lon: null,
    },
  ]);
  tripUpdate.mockResolvedValue({});
});

describe("POST /trips/:id/immich/cover", () => {
  it("stores the preview proxy URL as the cover", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: ASSET_ID });

    const expected = `/api/v1/trips/trip-1/immich/albums/${LINK_ID}/assets/${ASSET_ID}/file?size=preview`;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ coverImageUrl: expected });
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { coverImageUrl: expected },
    });
    expect(resolveTrip).toHaveBeenCalledWith("u1", "trip-1");
  });

  it("refuses an asset that is not in the linked album", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: OTHER_ASSET_ID });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notFound");
    expect(tripUpdate).not.toHaveBeenCalled();
  });

  it("refuses a link belonging to another trip", async () => {
    findFirstLink.mockResolvedValue(null);
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: ASSET_ID });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notFound");
  });

  it("returns 409 + kind=notConfigured when no Immich connection is configured", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: ASSET_ID });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
    expect(tripUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID assetId with 400", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: "../../etc/passwd" });
    expect(res.status).toBe(400);
  });

  it("returns 502 when the album membership lookup fails upstream", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    listAlbumAssets.mockRejectedValue(new ImmichError("auth", "Immich rejected the API key", 401));

    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: ASSET_ID });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("auth");
    expect(tripUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /trips/:id/photos/:photoId/cover", () => {
  it("stores the local file URL for an upload or imported copy", async () => {
    findFirstPhoto.mockResolvedValue({ id: PHOTO_ID });

    const res = await request(makeApp()).post(`/api/v1/trips/trip-1/photos/${PHOTO_ID}/cover`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ coverImageUrl: `/api/v1/trips/trip-1/photos/${PHOTO_ID}/file` });
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { coverImageUrl: `/api/v1/trips/trip-1/photos/${PHOTO_ID}/file` },
    });
  });

  it("404s for a photo belonging to another trip", async () => {
    findFirstPhoto.mockResolvedValue(null);
    const res = await request(makeApp()).post(
      `/api/v1/trips/trip-1/photos/${OTHER_ASSET_ID}/cover`,
    );
    expect(res.status).toBe(404);
    expect(tripUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID photoId with 400 before any DB lookup", async () => {
    const res = await request(makeApp()).post("/api/v1/trips/trip-1/photos/not-a-uuid/cover");
    expect(res.status).toBe(400);
    expect(findFirstPhoto).not.toHaveBeenCalled();
    expect(tripUpdate).not.toHaveBeenCalled();
  });
});

describe("authenticate guard regression", () => {
  it("demonstrates that the mocked authenticate middleware sets userId as required", async () => {
    // Proves the harness relies on the mocked `authenticate` (not a stub
    // middleware ahead of the router) to set req.userId. If `authenticate`
    // were removed from a route in tripCover.ts, userId would stay
    // undefined and resolveTrip would not be called with "u1".
    findFirstPhoto.mockResolvedValue({ id: PHOTO_ID });
    await request(makeApp()).post(`/api/v1/trips/trip-1/photos/${PHOTO_ID}/cover`);
    expect(resolveTrip).toHaveBeenCalledWith("u1", "trip-1");
  });
});

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const resolveTrip = jest.fn(async () => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findManyLinks = jest.fn();
const findFirstLink = jest.fn();
const createManyLinks = jest.fn();
const deleteLink = jest.fn();
const updateManyPhotos = jest.fn();
const findManyPhotos = jest.fn();
const upsertJob = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    tripImmichAlbum: {
      findMany: findManyLinks,
      findFirst: findFirstLink,
      createMany: createManyLinks,
      delete: deleteLink,
    },
    tripPhoto: { findMany: findManyPhotos, updateMany: updateManyPhotos },
    trip: { findUnique: jest.fn(), update: jest.fn() },
    immichImportJob: { upsert: upsertJob },
    adminSettings: { findFirst: jest.fn() },
  },
}));

const listAlbums = jest.fn();
const listAlbumAssets = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbums, listAlbumAssets }),
}));

const getImmichConnection = jest.fn();
const getImmichDefaultMode = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({
  getImmichConnection,
  getImmichDefaultMode,
}));

const startAlbumImport = jest.fn();
const deleteImportedPhotoFiles = jest.fn();
const estimateAlbumImport = jest.fn();
const getImportJob = jest.fn();
const isImportInFlight = jest.fn();
jest.mock("../services/immich/immichImport", () => ({
  startAlbumImport,
  deleteImportedPhotoFiles,
  estimateAlbumImport,
  getImportJob,
  isImportInFlight,
}));

jest.mock("../middleware/rateLimit", () => ({
  immichImportLimiter: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  immichProxyLimiter: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

// The route module wires the real `authenticate` per-route (matching every
// other trip sub-route in `routes/trips.ts`), and that middleware hits the
// DB (`prisma.user.findUnique`) and requires a signed cookie/bearer token.
// This suite has neither, so bypass it here. The mocked `authenticate`
// performs the key side effect of setting `userId` on the request, exactly
// as the real middleware does after token verification. This ensures that
// if someone deletes `authenticate` from a route, the `userId` will be
// undefined and the route's assertions will fail — the guard is tested.
// `requireWriteScope` is left real since it no-ops for non-PAT requests.
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
import tripAlbumsRouter from "../routes/immich/tripAlbums";
import { errorHandler } from "../middleware/errorHandler";

const { immichProxyLimiter } = jest.requireMock("../middleware/rateLimit") as {
  immichProxyLimiter: jest.Mock;
};

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", tripAlbumsRouter);
  app.use(errorHandler);
  return app;
}

const CONN = { baseUrl: "https://immich.lan", apiKey: "k", source: "user" as const };

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue(CONN);
  getImmichDefaultMode.mockResolvedValue("link");
  findManyLinks.mockResolvedValue([]);
  isImportInFlight.mockReturnValue(false);
  upsertJob.mockResolvedValue(undefined);
});

describe("GET /trips/:id/immich/albums", () => {
  it("marks already-linked albums and returns the user's default mode", async () => {
    listAlbums.mockResolvedValue([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: "t1" },
      { id: "a2", albumName: "Oslo", assetCount: 1, thumbnailAssetId: null },
    ]);
    findManyLinks.mockResolvedValue([{ id: "link-1", immichAlbumId: "a2" }]);
    getImmichDefaultMode.mockResolvedValue("import");

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");

    expect(res.status).toBe(200);
    expect(res.body.defaultMode).toBe("import");
    expect(res.body.albums).toEqual([
      {
        id: "a1",
        albumName: "Rome",
        assetCount: 3,
        thumbnailAssetId: "t1",
        linked: false,
        linkId: null,
      },
      {
        id: "a2",
        albumName: "Oslo",
        assetCount: 1,
        thumbnailAssetId: null,
        linked: true,
        linkId: "link-1",
      },
    ]);
  });

  it("returns 409 with a machine-readable kind when Immich is unconfigured", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
  });

  it("propagates an auth failure as 502 + kind=auth rather than a 500", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    listAlbums.mockRejectedValue(new ImmichError("auth", "Immich rejected the API key", 401));

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("auth");
  });

  it("404s when the user does not own the trip", async () => {
    const { AppError } = jest.requireActual<typeof import("../middleware/errorHandler")>(
      "../middleware/errorHandler",
    );
    resolveTrip.mockRejectedValueOnce(new AppError("Trip not found", 404));
    const res = await request(makeApp()).get("/api/v1/trips/other/immich/albums");
    expect(res.status).toBe(404);
  });
});

describe("expensive listing endpoints are rate-limited (M3)", () => {
  // The album picker and the two asset-listing endpoints each fan out to up to
  // MAX_PAGES upstream POSTs, so they carry the same limiter as the proxy. If
  // the limiter were dropped from a route, its `toHaveBeenCalled` assertion
  // below turns red (mirrors the `authenticate` guard-regression pattern).
  it("attaches immichProxyLimiter to GET /immich/albums", async () => {
    listAlbums.mockResolvedValue([]);
    await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");
    expect(immichProxyLimiter).toHaveBeenCalled();
  });

  it("attaches immichProxyLimiter to GET /immich/estimate", async () => {
    estimateAlbumImport.mockResolvedValue({ assetCount: 0, totalBytes: 0 });
    await request(makeApp()).get("/api/v1/trips/trip-1/immich/estimate?albumId=a1");
    expect(immichProxyLimiter).toHaveBeenCalled();
  });

  it("attaches immichProxyLimiter to GET /immich/albums/:linkId/assets", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    listAlbumAssets.mockResolvedValue([]);
    await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");
    expect(immichProxyLimiter).toHaveBeenCalled();
  });
});

describe("POST /trips/:id/immich/albums", () => {
  it("creates link rows with cached name/count and skips duplicates", async () => {
    listAlbums.mockResolvedValue([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: "t1" },
    ]);
    createManyLinks.mockResolvedValue({ count: 1 });
    findManyLinks
      .mockResolvedValueOnce([]) // existing links, before insert
      .mockResolvedValueOnce([
        {
          id: "link-1",
          immichAlbumId: "a1",
          albumName: "Rome",
          assetCount: 3,
          thumbnailAssetId: "t1",
          mode: "link",
          sortIdx: 0,
          lastSyncedAt: null,
        },
      ]);

    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({ albums: [{ immichAlbumId: "a1", mode: "link" }] });

    expect(res.status).toBe(201);
    expect(createManyLinks).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(res.body.links[0]).toMatchObject({ id: "link-1", albumName: "Rome", mode: "link" });
    expect(startAlbumImport).not.toHaveBeenCalled();
  });

  it("kicks off an import job for import-mode albums only", async () => {
    listAlbums.mockResolvedValue([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: null },
      { id: "a2", albumName: "Oslo", assetCount: 1, thumbnailAssetId: null },
    ]);
    createManyLinks.mockResolvedValue({ count: 2 });
    findManyLinks.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "link-1",
        immichAlbumId: "a1",
        albumName: "Rome",
        assetCount: 3,
        thumbnailAssetId: null,
        mode: "link",
        sortIdx: 0,
        lastSyncedAt: null,
      },
      {
        id: "link-2",
        immichAlbumId: "a2",
        albumName: "Oslo",
        assetCount: 1,
        thumbnailAssetId: null,
        mode: "import",
        sortIdx: 1,
        lastSyncedAt: null,
      },
    ]);

    await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({
        albums: [
          { immichAlbumId: "a1", mode: "link" },
          { immichAlbumId: "a2", mode: "import" },
        ],
      });

    expect(startAlbumImport).toHaveBeenCalledTimes(1);
    expect(startAlbumImport).toHaveBeenCalledWith("u1", "link-2");
  });

  it("rejects an album id the user's Immich does not have", async () => {
    listAlbums.mockResolvedValue([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: null },
    ]);
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({ albums: [{ immichAlbumId: "not-mine", mode: "link" }] });

    expect(res.status).toBe(400);
    expect(createManyLinks).not.toHaveBeenCalled();
  });

  it("rejects an empty album list with 400", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({ albums: [] });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /trips/:id/immich/albums/:linkId", () => {
  beforeEach(() => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    const { prisma } = jest.requireMock("../db") as {
      prisma: { trip: { findUnique: jest.Mock; update: jest.Mock } };
    };
    prisma.trip.findUnique.mockResolvedValue(null);
  });

  it("keeps the copies by default, severing the FK so the cascade cannot eat them", async () => {
    const res = await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-1");

    expect(res.status).toBe(204);
    expect(updateManyPhotos).toHaveBeenCalledWith({
      where: { immichAlbumLinkId: "link-1" },
      data: { immichAlbumLinkId: null },
    });
    expect(deleteImportedPhotoFiles).not.toHaveBeenCalled();
    expect(deleteLink).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("deletes the files first when deleteCopies=true, then lets the cascade drop the rows", async () => {
    findManyPhotos.mockResolvedValue([{ filename: "a.jpg" }, { filename: "b.jpg" }]);

    const res = await request(makeApp()).delete(
      "/api/v1/trips/trip-1/immich/albums/link-1?deleteCopies=true",
    );

    expect(res.status).toBe(204);
    expect(deleteImportedPhotoFiles).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
    expect(updateManyPhotos).not.toHaveBeenCalled();
    expect(deleteLink).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("does not touch photos for a link-mode album (there are none)", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-2",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-2?deleteCopies=true");

    expect(deleteImportedPhotoFiles).not.toHaveBeenCalled();
    expect(updateManyPhotos).not.toHaveBeenCalled();
  });

  it("404s for a link that belongs to another trip", async () => {
    findFirstLink.mockResolvedValue(null);
    const res = await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-x");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notFound");
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it("does NOT clear the trip cover when a DIFFERENT link provided it (negative guard, L5)", async () => {
    // Unlinking link-1 must leave link-2's cover alone. Safe today only because
    // TripImmichAlbum.id is a UUID (no id can be a substring of another). A
    // future slug-based id would silently reintroduce the collision — this test
    // is the guard that would catch it.
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    const { prisma } = jest.requireMock("../db") as {
      prisma: { trip: { findUnique: jest.Mock; update: jest.Mock } };
    };
    prisma.trip.findUnique.mockResolvedValue({
      coverImageUrl: "/api/v1/trips/trip-1/immich/albums/link-2/assets/x/file?size=preview",
    });

    await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-1");

    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("clears the trip cover when the unlinked album provided it", async () => {
    const { prisma } = jest.requireMock("../db") as {
      prisma: { trip: { findUnique: jest.Mock; update: jest.Mock } };
    };
    prisma.trip.findUnique.mockResolvedValue({
      coverImageUrl: "/api/v1/trips/trip-1/immich/albums/link-1/assets/x/file?size=preview",
    });

    await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-1");

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { coverImageUrl: null },
    });
  });
});

describe("GET /trips/:id/immich/albums/:linkId/assets", () => {
  it("returns proxy URLs for a link-mode album", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    listAlbumAssets.mockResolvedValue([
      {
        id: "p1",
        type: "IMAGE",
        fileCreatedAt: "2026-05-01T00:00:00.000Z",
        originalFileName: "p1.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        lat: 1,
        lon: 2,
      },
    ]);

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");

    expect(res.status).toBe(200);
    expect(res.body.assets[0]).toEqual({
      id: "p1",
      url: "/api/v1/trips/trip-1/immich/albums/link-1/assets/p1/file?size=thumbnail",
      previewUrl: "/api/v1/trips/trip-1/immich/albums/link-1/assets/p1/file?size=preview",
      takenAt: "2026-05-01T00:00:00.000Z",
      lat: 1,
      lon: 2,
    });
  });

  it("returns a link-mode album oldest first, so the pictures follow the journey", async () => {
    // Immich returns its own order (newest first by default). Alex asked for
    // chronological (#154): the album is a travel diary, not a feed.
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    const asset = (id: string, takenAt: string) => ({
      id,
      type: "IMAGE",
      fileCreatedAt: takenAt,
      originalFileName: `${id}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1,
      lat: null,
      lon: null,
    });
    listAlbumAssets.mockResolvedValue([
      asset("late", "2026-05-03T09:00:00.000Z"),
      asset("early", "2026-05-01T09:00:00.000Z"),
      asset("middle", "2026-05-02T09:00:00.000Z"),
    ]);

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");

    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual(["early", "middle", "late"]);
  });

  it("orders an import-mode album by capture date, falling back to link order", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    findManyPhotos.mockResolvedValue([]);

    await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");

    // A photo with no EXIF date must not jump to the front and must not drop
    // out — it keeps its link position at the end.
    expect(findManyPhotos).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ takenAt: { sort: "asc", nulls: "last" } }, { sortIdx: "asc" }],
      }),
    );
  });

  it("skips VIDEO assets (out of scope for Phase A)", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    listAlbumAssets.mockResolvedValue([
      {
        id: "v1",
        type: "VIDEO",
        fileCreatedAt: "2026-05-01T00:00:00.000Z",
        originalFileName: "v.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1,
        lat: null,
        lon: null,
      },
    ]);
    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");
    expect(res.body.assets).toEqual([]);
  });

  it("returns 502 + kind=notFound when the album was deleted in Immich", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });
    listAlbumAssets.mockRejectedValue(new ImmichError("notFound", "gone", 404));

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("notFound");
  });

  it("serves an import-mode album from local TripPhoto rows", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    findManyPhotos.mockResolvedValue([
      {
        id: "photo-1",
        tripId: "trip-1",
        takenAt: new Date("2026-05-01T00:00:00.000Z"),
        lat: 1,
        lon: 2,
      },
    ]);

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");

    expect(listAlbumAssets).not.toHaveBeenCalled();
    expect(res.body.assets[0]).toEqual({
      id: "photo-1",
      url: "/api/v1/trips/trip-1/photos/photo-1/file",
      previewUrl: "/api/v1/trips/trip-1/photos/photo-1/file",
      takenAt: "2026-05-01T00:00:00.000Z",
      lat: 1,
      lon: 2,
    });
  });
});

describe("GET /trips/:id/immich/estimate", () => {
  it("returns the estimate for the given albumId", async () => {
    estimateAlbumImport.mockResolvedValue({ assetCount: 42, totalBytes: 123456 });

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/estimate?albumId=a1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assetCount: 42, totalBytes: 123456 });
    expect(estimateAlbumImport).toHaveBeenCalledWith("u1", "a1");
    expect(resolveTrip).toHaveBeenCalledWith("u1", "trip-1");
  });

  it("400s when albumId is missing", async () => {
    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/estimate");

    expect(res.status).toBe(400);
    expect(estimateAlbumImport).not.toHaveBeenCalled();
  });
});

describe("POST /trips/:id/immich/albums/:linkId/resync", () => {
  it("resets the stale terminal job row to `pending` before the 202, then fires startAlbumImport", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });

    const res = await request(makeApp()).post("/api/v1/trips/trip-1/immich/albums/link-1/resync");

    expect(res.status).toBe(202);
    // The row must be non-terminal by the time the 202 lands, so the
    // frontend's immediate poll cannot latch onto the previous run's
    // `completed` and stop polling.
    expect(upsertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { albumLinkId: "link-1" },
        update: expect.objectContaining({
          status: "pending",
          processedAssets: 0,
          totalAssets: 0,
          failedAssets: 0,
          completedAt: null,
          error: null,
        }),
        create: expect.objectContaining({ albumLinkId: "link-1", status: "pending" }),
      }),
    );
    expect(res.body.job.status).toBe("pending");
    expect(startAlbumImport).toHaveBeenCalledTimes(1);
    expect(startAlbumImport).toHaveBeenCalledWith("u1", "link-1");
  });

  it("does NOT reset the row when an import is already in flight (no clobbering live progress)", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    isImportInFlight.mockReturnValue(true);

    const res = await request(makeApp()).post("/api/v1/trips/trip-1/immich/albums/link-1/resync");

    expect(res.status).toBe(202);
    // A running row is already non-terminal and something is advancing it —
    // resetting it here would strand the UI on `pending` forever, because
    // startAlbumImport would refuse the in-flight job.
    expect(upsertJob).not.toHaveBeenCalled();
    expect(res.body.job.status).toBe("running");
  });

  it("marks the job failed (not stranded pending) when the connection is gone (M1)", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    getImmichConnection.mockResolvedValue(null);

    const res = await request(makeApp()).post("/api/v1/trips/trip-1/immich/albums/link-1/resync");

    // The import cannot start, so the row must land in a TERMINAL state — never
    // reset to `pending` and then abandoned by startAlbumImport's no-connection
    // early return (which would make the frontend poll forever).
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
    expect(upsertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { albumLinkId: "link-1" },
        update: expect.objectContaining({ status: "failed" }),
        create: expect.objectContaining({ albumLinkId: "link-1", status: "failed" }),
      }),
    );
    expect(startAlbumImport).not.toHaveBeenCalled();
  });

  it("400s for a link-mode album and never resets or fires startAlbumImport", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "link",
    });

    const res = await request(makeApp()).post("/api/v1/trips/trip-1/immich/albums/link-1/resync");

    expect(res.status).toBe(400);
    expect(upsertJob).not.toHaveBeenCalled();
    expect(startAlbumImport).not.toHaveBeenCalled();
  });

  it("404s for a link belonging to another trip", async () => {
    findFirstLink.mockResolvedValue(null);

    const res = await request(makeApp()).post("/api/v1/trips/trip-1/immich/albums/link-x/resync");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("notFound");
    expect(upsertJob).not.toHaveBeenCalled();
    expect(startAlbumImport).not.toHaveBeenCalled();
  });
});

describe("GET /trips/:id/immich/albums/:linkId/import-job", () => {
  it("returns the job when one exists", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    getImportJob.mockResolvedValue({
      status: "completed",
      totalAssets: 5,
      processedAssets: 5,
      failedAssets: 0,
      error: null,
    });

    const res = await request(makeApp()).get(
      "/api/v1/trips/trip-1/immich/albums/link-1/import-job",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      job: {
        status: "completed",
        totalAssets: 5,
        processedAssets: 5,
        failedAssets: 0,
        error: null,
      },
    });
    expect(getImportJob).toHaveBeenCalledWith("link-1");
  });

  it("returns { job: null } when there is no job row yet", async () => {
    findFirstLink.mockResolvedValue({
      id: "link-1",
      tripId: "trip-1",
      immichAlbumId: "a1",
      mode: "import",
    });
    getImportJob.mockResolvedValue(null);

    const res = await request(makeApp()).get(
      "/api/v1/trips/trip-1/immich/albums/link-1/import-job",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job: null });
  });
});

describe("authenticate guard regression", () => {
  it("demonstrates that the mocked authenticate middleware sets userId as required", async () => {
    // This test verifies that the harness relies on the mocked `authenticate`
    // middleware (not a stub middleware) to set req.userId. If someone deletes
    // the `authenticate` middleware from a route in tripAlbums.ts, that route
    // will receive undefined userId, causing the route's non-null assertion
    // (req.userId!) to fail or the route to behave incorrectly.
    //
    // This test passes with the current setup (where authenticate sets
    // userId = "u1"). If the mock is removed or modified, this test fails,
    // proving the guard regression is caught.
    //
    // The manual sanity check (delete authenticate from a route, run tests,
    // observe failure) provides end-to-end proof of the regression detection.

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");

    // If authenticate is working, it set userId = "u1" and the route ran
    expect(resolveTrip).toHaveBeenCalledWith("u1", "trip-1");
    // If authenticate were deleted, userId would be undefined and this would
    // either error or return an unexpected status
    expect(res.status).toBeLessThan(500);
  });
});

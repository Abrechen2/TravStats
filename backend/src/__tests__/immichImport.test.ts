import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { Prisma } from "@prisma/client";
import { FILE_LIMITS } from "../config/constants";

const jobUpsert = jest.fn();
const jobUpdate = jest.fn();
const jobUpdateMany = jest.fn();
const jobFindUnique = jest.fn();
const linkFindUnique = jest.fn();
const linkUpdate = jest.fn();
const photoFindMany = jest.fn();
const photoCreate = jest.fn();
const photoAggregate = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    immichImportJob: {
      upsert: jobUpsert,
      update: jobUpdate,
      updateMany: jobUpdateMany,
      findUnique: jobFindUnique,
    },
    tripImmichAlbum: { findUnique: linkFindUnique, update: linkUpdate },
    tripPhoto: { findMany: photoFindMany, create: photoCreate, aggregate: photoAggregate },
  },
}));

const listAlbumAssets = jest.fn();
const fetchAssetStream = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets, fetchAssetStream }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

const writtenFiles: string[] = [];
jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  createWriteStream: jest.fn((p: string) => {
    writtenFiles.push(p);
    const { PassThrough } = jest.requireActual<typeof import("stream")>("stream");
    const sink = new PassThrough();
    sink.on("data", () => {});
    return sink;
  }),
  unlinkSync: jest.fn(),
}));

jest.mock("../middleware/upload", () => ({
  getTripPhotoDir: () => "/data/uploads/trip-photos",
  deleteTripPhotoFile: jest.fn(),
}));

const loggerWarn = jest.fn();
const loggerInfo = jest.fn();
const loggerError = jest.fn();
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { warn: loggerWarn, info: loggerInfo, error: loggerError, debug: jest.fn() },
}));

import {
  startAlbumImport,
  estimateAlbumImport,
  createByteCapStream,
  IMPORT_ALLOWED_MIME_TYPES,
  IMPORT_STALE_AFTER_MS,
  clearImportGuards,
} from "../services/immich/immichImport";

const unlinkSyncMock = jest.requireMock("fs").unlinkSync as jest.Mock;

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-05-01T00:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1000,
  lat: 1,
  lon: 2,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearImportGuards();
  writtenFiles.length = 0;
  getImmichConnection.mockResolvedValue({
    baseUrl: "https://immich.lan",
    apiKey: "k",
    source: "user",
  });
  linkFindUnique.mockResolvedValue({
    id: "link-1",
    tripId: "trip-1",
    immichAlbumId: "a1",
    mode: "import",
  });
  jobFindUnique.mockResolvedValue(null);
  jobUpsert.mockResolvedValue({ id: "job-1", status: "running" });
  photoFindMany.mockResolvedValue([]);
  photoCreate.mockResolvedValue({ id: "photo-1" });
  fetchAssetStream.mockImplementation(async () => ({
    stream: Readable.from([Buffer.from("bytes")]),
    contentType: "image/jpeg",
    contentLength: 5,
  }));
});

describe("startAlbumImport", () => {
  it("downloads every asset and records provenance + coordinates", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("p2")]);

    await startAlbumImport("u1", "link-1");

    expect(fetchAssetStream).toHaveBeenCalledWith("p1", "original");
    expect(fetchAssetStream).toHaveBeenCalledWith("p2", "original");
    expect(photoCreate).toHaveBeenCalledTimes(2);
    expect(photoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tripId: "trip-1",
          immichAssetId: "p1",
          immichAlbumLinkId: "link-1",
          mimetype: "image/jpeg",
          lat: 1,
          lon: 2,
        }),
      }),
    );
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }),
    );
  });

  it("is idempotent — already-imported assets are skipped on re-sync", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("p2")]);
    photoFindMany.mockResolvedValue([{ immichAssetId: "p1" }]);

    await startAlbumImport("u1", "link-1");

    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
    expect(fetchAssetStream).toHaveBeenCalledWith("p2", "original");
  });

  it("skips videos and disallowed mime types without failing the job", async () => {
    listAlbumAssets.mockResolvedValue([
      asset("v1", { type: "VIDEO", mimeType: "video/mp4" }),
      asset("x1", { mimeType: "image/heic" }),
      asset("p1"),
    ]);

    await startAlbumImport("u1", "link-1");

    expect(IMPORT_ALLOWED_MIME_TYPES).not.toContain("image/heic");
    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
    expect(fetchAssetStream).toHaveBeenCalledWith("p1", "original");
  });

  it("counts a per-asset failure, keeps the successes, and still completes", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("p2")]);
    fetchAssetStream.mockRejectedValueOnce(new Error("upstream died")).mockResolvedValueOnce({
      stream: Readable.from([Buffer.from("bytes")]),
      contentType: "image/jpeg",
      contentLength: 5,
    });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", failedAssets: 1 }),
      }),
    );
  });

  it("refuses to start a second run while one is already running", async () => {
    jobFindUnique.mockResolvedValue({ id: "job-1", status: "running", updatedAt: new Date() });

    await startAlbumImport("u1", "link-1");

    expect(listAlbumAssets).not.toHaveBeenCalled();
    expect(jobUpsert).not.toHaveBeenCalled();
  });

  it("treats a (tripId, immichAssetId) unique-index clash (P2002) as already-present, not a failure (M5)", async () => {
    // A sibling import-mode album sharing this asset created the row first —
    // the download raced it. That is not a failure: the asset IS in the trip.
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("shared")]);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
      meta: { target: ["trip_id", "immich_asset_id"] },
    });
    photoCreate.mockResolvedValueOnce({ id: "photo-1" }).mockRejectedValueOnce(p2002);

    await startAlbumImport("u1", "link-1");

    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", failedAssets: 0 }),
      }),
    );
    // The duplicate bytes we downloaded must be cleaned up (a sibling owns the row).
    expect(unlinkSyncMock).toHaveBeenCalled();
  });

  it("marks the job failed when the album listing itself fails", async () => {
    listAlbumAssets.mockRejectedValue(new Error("immich down"));

    await expect(startAlbumImport("u1", "link-1")).resolves.toBeUndefined();

    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "immich down" }),
      }),
    );
  });

  it("stamps lastSyncedAt on the link when the run completes", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1")]);
    await startAlbumImport("u1", "link-1");
    expect(linkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-1" },
        data: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      }),
    );
  });

  it("does nothing when Immich is unconfigured", async () => {
    getImmichConnection.mockResolvedValue(null);
    await startAlbumImport("u1", "link-1");
    expect(listAlbumAssets).not.toHaveBeenCalled();
  });

  it("marks a lingering pending/running row failed when the connection is gone (M1 race backstop)", async () => {
    getImmichConnection.mockResolvedValue(null);
    await startAlbumImport("u1", "link-1");
    expect(jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { albumLinkId: "link-1", status: { in: ["pending", "running"] } },
        data: expect.objectContaining({ status: "failed", error: "notConfigured" }),
      }),
    );
  });
});

describe("startAlbumImport per-asset byte cap (M2)", () => {
  it("skips an asset Immich already reports as oversized, counts it failed, never downloads it", async () => {
    listAlbumAssets.mockResolvedValue([
      asset("big", { sizeBytes: FILE_LIMITS.IMMICH_MAX_ASSET_BYTES + 1 }),
      asset("ok", { sizeBytes: 1000 }),
    ]);

    await startAlbumImport("u1", "link-1");

    // The oversized asset must not even be fetched.
    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
    expect(fetchAssetStream).toHaveBeenCalledWith("ok", "original");
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "immich_import_asset_too_large",
        context: expect.objectContaining({ assetId: "big" }),
      }),
    );
    // Oversized = a per-asset failure, not an aborted run.
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", failedAssets: 1, processedAssets: 1 }),
      }),
    );
  });
});

describe("createByteCapStream", () => {
  it("passes bytes through under the cap", async () => {
    const sink = new (jest.requireActual<typeof import("stream")>("stream").PassThrough)();
    const chunks: Buffer[] = [];
    sink.on("data", (c: Buffer) => chunks.push(c));
    await pipeline(Readable.from([Buffer.from("hello")]), createByteCapStream(100), sink);
    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("aborts with a distinguishable error once the cumulative bytes exceed the cap", async () => {
    const sink = new (jest.requireActual<typeof import("stream")>("stream").PassThrough)();
    sink.resume();
    await expect(
      pipeline(
        Readable.from([Buffer.from("aaaa"), Buffer.from("bbbb"), Buffer.from("cccc")]),
        createByteCapStream(6),
        sink,
      ),
    ).rejects.toMatchObject({ code: "IMMICH_ASSET_TOO_LARGE" });
  });
});

describe("startAlbumImport concurrency guard", () => {
  it("in-memory guard: two calls fired without awaiting the first result in exactly one listAlbumAssets call", async () => {
    let resolveAssets!: (value: ReturnType<typeof asset>[]) => void;
    listAlbumAssets.mockReturnValue(
      new Promise<ReturnType<typeof asset>[]>((resolve) => {
        resolveAssets = resolve;
      }),
    );

    const first = startAlbumImport("u1", "link-1");
    const second = startAlbumImport("u1", "link-1");

    resolveAssets([asset("p1")]);
    await Promise.all([first, second]);

    expect(listAlbumAssets).toHaveBeenCalledTimes(1);
  });

  it("releases the guard after a completed run so a later re-sync proceeds", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1")]);

    await startAlbumImport("u1", "link-1");
    await startAlbumImport("u1", "link-1");

    expect(listAlbumAssets).toHaveBeenCalledTimes(2);
  });

  it("releases the guard after a failed run so a later re-sync proceeds", async () => {
    listAlbumAssets.mockRejectedValueOnce(new Error("immich down"));
    await startAlbumImport("u1", "link-1");

    listAlbumAssets.mockResolvedValueOnce([asset("p1")]);
    await startAlbumImport("u1", "link-1");

    expect(listAlbumAssets).toHaveBeenCalledTimes(2);
  });
});

describe("startAlbumImport stale running-job reclaim", () => {
  it("reclaims a running job whose last progress write is older than IMPORT_STALE_AFTER_MS", async () => {
    const staleUpdatedAt = new Date(Date.now() - IMPORT_STALE_AFTER_MS - 60_000);
    jobFindUnique.mockResolvedValue({ id: "job-1", status: "running", updatedAt: staleUpdatedAt });
    listAlbumAssets.mockResolvedValue([asset("p1")]);

    await startAlbumImport("u1", "link-1");

    expect(listAlbumAssets).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "immich_import_reclaimed_stale_job",
        context: expect.objectContaining({ linkId: "link-1" }),
      }),
    );
  });

  it("still refuses a running job whose last progress write is fresh", async () => {
    jobFindUnique.mockResolvedValue({ id: "job-1", status: "running", updatedAt: new Date() });

    await startAlbumImport("u1", "link-1");

    expect(listAlbumAssets).not.toHaveBeenCalled();
    expect(jobUpsert).not.toHaveBeenCalled();
  });
});

describe("estimateAlbumImport", () => {
  it("sums importable asset sizes and ignores videos", async () => {
    listAlbumAssets.mockResolvedValue([
      asset("p1", { sizeBytes: 1000 }),
      asset("p2", { sizeBytes: 2500 }),
      asset("v1", { type: "VIDEO", mimeType: "video/mp4", sizeBytes: 999999 }),
    ]);

    await expect(estimateAlbumImport("u1", "a1")).resolves.toEqual({
      assetCount: 2,
      totalBytes: 3500,
    });
  });

  it("treats an unknown size as zero rather than NaN", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1", { sizeBytes: null })]);
    await expect(estimateAlbumImport("u1", "a1")).resolves.toEqual({
      assetCount: 1,
      totalBytes: 0,
    });
  });
});

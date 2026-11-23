import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Prisma } from "../prisma";

const resolveTrip = jest.fn(async (..._args: unknown[]) => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findManyLinks =
  jest.fn<
    (
      args: import("../prisma").Prisma.TripImmichAlbumFindManyArgs
    ) => Promise<Partial<import("../generated/prisma/client").TripImmichAlbum>[]>
  >();
const findFirstLink =
  jest.fn<
    (
      args: import("../prisma").Prisma.TripImmichAlbumFindFirstArgs
    ) => Promise<Partial<import("../generated/prisma/client").TripImmichAlbum> | null>
  >();
const createManyLinks =
  jest.fn<
    (args: import("../prisma").Prisma.TripImmichAlbumCreateManyArgs) => Promise<{ count: number }>
  >();
const deleteLink =
  jest.fn<
    (
      args: import("../prisma").Prisma.TripImmichAlbumDeleteArgs
    ) => Promise<Partial<import("../generated/prisma/client").TripImmichAlbum>>
  >();
const updateManyPhotos =
  jest.fn<
    (args: import("../prisma").Prisma.TripPhotoUpdateManyArgs) => Promise<{ count: number }>
  >();
const findManyPhotos =
  jest.fn<
    (
      args: import("../prisma").Prisma.TripPhotoFindManyArgs
    ) => Promise<Partial<import("../generated/prisma/client").TripPhoto>[]>
  >();
const upsertJob =
  jest.fn<
    (
      args: import("../prisma").Prisma.ImmichImportJobUpsertArgs
    ) => Promise<Partial<import("../generated/prisma/client").ImmichImportJob>>
  >();
jest.mock("../db", () => ({
  prisma: {
    tripImmichAlbum: {
      findMany: findManyLinks,
      findFirst: findFirstLink,
      createMany: createManyLinks,
      delete: deleteLink,
    },
    tripPhoto: { findMany: findManyPhotos, updateMany: updateManyPhotos },
    trip: {
      findUnique:
        jest.fn<
          (
            args: import("../prisma").Prisma.TripFindUniqueArgs
          ) => Promise<Partial<import("../generated/prisma/client").Trip> | null>
        >(),
      update:
        jest.fn<
          (
            args: import("../prisma").Prisma.TripUpdateArgs
          ) => Promise<Partial<import("../generated/prisma/client").Trip>>
        >(),
    },
    immichImportJob: { upsert: upsertJob },
    adminSettings: {
      findFirst:
        jest.fn<
          (
            args: import("../prisma").Prisma.AdminSettingsFindFirstArgs
          ) => Promise<Partial<import("../generated/prisma/client").AdminSettings> | null>
        >(),
    },
  },
}));

const listAlbums = jest.fn<import("../services/immich/immichClient").ImmichClient["listAlbums"]>();
const listAlbumAssets =
  jest.fn<import("../services/immich/immichClient").ImmichClient["listAlbumAssets"]>();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbums, listAlbumAssets }),
}));

const getImmichConnection =
  jest.fn<typeof import("../services/immich/immichResolver").getImmichConnection>();
const getImmichDefaultMode =
  jest.fn<typeof import("../services/immich/immichResolver").getImmichDefaultMode>();
jest.mock("../services/immich/immichResolver", () => ({
  getImmichConnection,
  getImmichDefaultMode,
}));

const startAlbumImport =
  jest.fn<typeof import("../services/immich/immichImport").startAlbumImport>();
const deleteImportedPhotoFiles =
  jest.fn<typeof import("../services/immich/immichImport").deleteImportedPhotoFiles>();
const estimateAlbumImport =
  jest.fn<typeof import("../services/immich/immichImport").estimateAlbumImport>();
const getImportJob =
  jest.fn<
    (
      linkId: string
    ) => Promise<Partial<
      NonNullable<
        Awaited<ReturnType<typeof import("../services/immich/immichImport").getImportJob>>
      >
    > | null>
  >();
const isImportInFlight =
  jest.fn<typeof import("../services/immich/immichImport").isImportInFlight>();
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

const CONN = {
  baseUrl: "https://immich.lan",
  apiKey: "k",
  source: "user" as const,
  allowPrivate: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue(CONN);
  getImmichDefaultMode.mockResolvedValue("link");
  findManyLinks.mockResolvedValue([]);
  isImportInFlight.mockReturnValue(false);
  upsertJob.mockResolvedValue({});
});

let zone = "UTC";
jest.mock("../shared/time/profileZone", () => ({
  profileZoneOf: async () => ({ zone, source: "profile" }),
}));

const asset = (id: string, takenAt: string | null) => ({
  id,
  type: "IMAGE" as const,
  fileCreatedAt: takenAt,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: null,
  lon: null,
});

const LINK = { id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "link" };
const base = "/api/v1/trips/trip-1/immich/albums/link-1";

beforeEach(() => {
  zone = "UTC";
  findFirstLink.mockResolvedValue(LINK);
});

describe("GET .../days (per-day counts)", () => {
  it("lists counts per day and names no asset", async () => {
    listAlbumAssets.mockResolvedValue([
      asset("a", "2026-05-01T09:00:00.000Z"),
      asset("b", "2026-05-01T10:00:00.000Z"),
      asset("c", "2026-05-02T10:00:00.000Z"),
      asset("d", null),
    ]);
    const res = await request(makeApp()).get(`${base}/days`);
    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([
      { day: "2026-05-01", count: 2 },
      { day: "2026-05-02", count: 1 },
      { day: null, count: 1 },
    ]);
    expect(res.body.total).toBe(4);
    expect(JSON.stringify(res.body)).not.toMatch(/"id"|file\?size|url/);
  });

  it("cuts days in the profile zone, so a late evening in Tokyo is the next day", async () => {
    zone = "Asia/Tokyo"; // UTC+9: 20:00Z on May 1 is 05:00 on May 2
    listAlbumAssets.mockResolvedValue([
      asset("a", "2026-05-01T10:00:00.000Z"),
      asset("b", "2026-05-01T20:00:00.000Z"),
    ]);
    const res = await request(makeApp()).get(`${base}/days`);
    expect(res.body.zone).toBe("Asia/Tokyo");
    expect(res.body.days).toEqual([
      { day: "2026-05-01", count: 1 },
      { day: "2026-05-02", count: 1 },
    ]);
  });

  it("answers the provider's failure kind instead of an empty strip", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types"
    );
    listAlbumAssets.mockRejectedValue(new ImmichError("unreachable", "down"));
    const res = await request(makeApp()).get(`${base}/days`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("unreachable");
  });

  it("answers 409 notConfigured when the connection is gone", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp()).get(`${base}/days`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
  });

  it("counts an import-mode album from its stored capture times, without touching the provider", async () => {
    findFirstLink.mockResolvedValue({ ...LINK, mode: "import" });
    findManyPhotos.mockResolvedValue([
      { id: "p1", takenAt: new Date("2026-05-01T09:00:00Z"), lat: null, lon: null },
      { id: "p2", takenAt: new Date("2026-05-03T09:00:00Z"), lat: null, lon: null },
    ]);
    const res = await request(makeApp()).get(`${base}/days`);
    expect(res.body.days).toEqual([
      { day: "2026-05-01", count: 1 },
      { day: "2026-05-03", count: 1 },
    ]);
    expect(listAlbumAssets).not.toHaveBeenCalled();
  });
});

describe("GET .../days/:day/assets (only the chosen day)", () => {
  const album = [
    asset("a", "2026-05-01T09:00:00.000Z"),
    asset("b", "2026-05-02T09:00:00.000Z"),
    asset("c", "2026-05-02T10:00:00.000Z"),
    asset("d", "2026-05-02T11:00:00.000Z"),
    asset("e", null),
  ];

  it("returns only the photos of that day, thumbnails and previews as proxy URLs", async () => {
    listAlbumAssets.mockResolvedValue(album);
    const res = await request(makeApp()).get(`${base}/days/2026-05-02/assets`);
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual(["b", "c", "d"]);
    expect(res.body.total).toBe(3);
    expect(res.body.nextOffset).toBeNull();
    expect(res.body.assets[0].url).toContain("size=thumbnail");
  });

  it("pages a day and hands out the next offset until it runs out", async () => {
    listAlbumAssets.mockResolvedValue(album);
    const first = await request(makeApp()).get(`${base}/days/2026-05-02/assets?limit=2`);
    expect(first.body.assets).toHaveLength(2);
    expect(first.body.nextOffset).toBe(2);
    const second = await request(makeApp()).get(`${base}/days/2026-05-02/assets?limit=2&offset=2`);
    expect(second.body.assets.map((a: { id: string }) => a.id)).toEqual(["d"]);
    expect(second.body.nextOffset).toBeNull();
  });

  it("serves the undated bucket and `all`", async () => {
    listAlbumAssets.mockResolvedValue(album);
    const undated = await request(makeApp()).get(`${base}/days/undated/assets`);
    expect(undated.body.assets.map((a: { id: string }) => a.id)).toEqual(["e"]);
    const all = await request(makeApp()).get(`${base}/days/all/assets?limit=3`);
    expect(all.body.total).toBe(5);
    expect(all.body.assets).toHaveLength(3);
  });

  it("refuses a malformed day and an oversized page", async () => {
    expect((await request(makeApp()).get(`${base}/days/yesterday/assets`)).status).toBe(400);
    expect((await request(makeApp()).get(`${base}/days/all/assets?limit=9999`)).status).toBe(400);
  });
});

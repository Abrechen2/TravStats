import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { Readable } from "node:stream";

const immichSearch = jest.fn<(r: unknown) => Promise<unknown>>();
const immichStream = jest.fn<(id: string, size: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichClient", () => ({
  createImmichClient: () => ({ searchAssetsByDate: immichSearch, fetchAssetStream: immichStream }),
}));
const getImmichConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichResolver", () => ({
  getImmichConnection: (userId: string) => getImmichConnection(userId),
}));
const ppSearch = jest.fn<(r: unknown) => Promise<unknown>>();
const ppStream = jest.fn<(id: string, size: string) => Promise<unknown>>();
jest.mock("../../services/photoSource/photoprismSource", () => ({
  createPhotoprismPhotoSource: () => ({
    kind: "photoprism",
    searchAssetsByTime: ppSearch,
    listAlbumAssets: async () => ({ assets: [], nextPage: null, truncated: false }),
    streamThumbnail: ppStream,
  }),
}));
const getPhotoprismConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/photoprism/photoprismResolver", () => ({
  getPhotoprismConnection: (userId: string) => getPhotoprismConnection(userId),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { ImmichError } from "../../services/immich/types";
import { clearTravTrackPhotoCache } from "../../services/travtrack/photos";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/photos` with PhotoPrism beside Immich: a hash id is a valid
 * asset id, the thumbnail streams from the photo's OWN provider, one source
 * failing leaves the other's photos in a 200 that names the failure, and the
 * sources route says what is connected without asking either library.
 */

const PREFIX = "travtrack-photos-pp-";
const T = Date.parse("2026-10-10T12:00:00Z");
const MIN = 60_000;
const WINDOW = {
  from: new Date(T - 60 * MIN).toISOString(),
  to: new Date(T + 120 * MIN).toISOString(),
};
const HASH = "ab".repeat(20);
const UUID = "00000000-0000-4000-8000-000000000001";
const conn = { baseUrl: "http://x.test", apiKey: "k", source: "user" };
const asset = (id: string, atMs: number) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: new Date(atMs).toISOString(),
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: -33.9,
  lon: 151.2,
});
const bytes = async () => ({
  stream: Readable.from([Buffer.from("img")]),
  contentType: "image/webp",
  contentLength: 3,
});

describe("TravTrack photos — PhotoPrism", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;
  const get = (path: string, query: Record<string, string> = WINDOW) =>
    request(app).get(`/api/v1/travtrack/${path}`).query(query).set("Cookie", cookie);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    clearTravTrackPhotoCache();
    for (const m of [immichSearch, immichStream, ppSearch, ppStream]) m.mockReset();
    getImmichConnection.mockReset().mockResolvedValue(conn);
    getPhotoprismConnection.mockReset().mockResolvedValue(conn);
    immichSearch.mockResolvedValue({ assets: [asset(UUID, T + 3 * MIN)], truncated: false });
    ppSearch.mockResolvedValue({ assets: [asset(HASH, T + 5 * MIN)], truncated: false });
    immichStream.mockImplementation(bytes);
    ppStream.mockImplementation(bytes);
    await storePoint(userId, { t: T, lat: 37.5, lon: 127.0 });
    await storePoint(userId, { t: T + 10 * MIN, lat: 37.5, lon: 127.02 });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("lists both sources' photos, each with its provider", async () => {
    const res = await get("photos");
    expect(res.status).toBe(200);
    expect(res.body.photos.map((p: { provider: string }) => p.provider)).toEqual([
      "immich",
      "photoprism",
    ]);
    expect(res.body.failures).toEqual([]);
  });

  it("streams a PhotoPrism thumbnail from PhotoPrism, an Immich one from Immich", async () => {
    expect((await get(`photos/${HASH}/file`, { ...WINDOW, provider: "photoprism" })).status).toBe(
      200
    );
    expect(ppStream).toHaveBeenCalledWith(HASH, "thumbnail");
    expect(immichStream).not.toHaveBeenCalled();
    expect((await get(`photos/${UUID}/file`)).status).toBe(200);
    expect(immichStream).toHaveBeenCalledWith(UUID, "thumbnail");
  });

  it("an id the window does not place for THAT provider is 404", async () => {
    expect((await get(`photos/${HASH}/file`, { ...WINDOW, provider: "immich" })).status).toBe(404);
    expect(immichStream).not.toHaveBeenCalled();
  });

  it("PhotoPrism failing keeps Immich's photos in a 200 naming the failure", async () => {
    ppSearch.mockRejectedValue(new ImmichError("unreachable", "down"));
    const res = await get("photos");
    expect(res.status).toBe(200);
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.failures).toEqual([{ provider: "photoprism", kind: "unreachable" }]);
  });

  it("every source failing answers 502 with the first kind and its provider", async () => {
    immichSearch.mockRejectedValue(new ImmichError("auth", "no"));
    ppSearch.mockRejectedValue(new ImmichError("unreachable", "down"));
    const res = await get("photos");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "auth", provider: "immich" });
    expect(res.body.failures).toHaveLength(2);
  });

  it("a thumbnail whose sources all fail answers the upstream placeholder, not a 500", async () => {
    immichSearch.mockRejectedValue(new ImmichError("unreachable", "down"));
    ppSearch.mockRejectedValue(new ImmichError("unreachable", "down"));
    const res = await get(`photos/${HASH}/file`, { ...WINDOW, provider: "photoprism" });
    expect(res.status).toBe(502);
  });

  it("only PhotoPrism connected still lists photos", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await get("photos");
    expect(res.status).toBe(200);
    expect(res.body.photos.map((p: { provider: string }) => p.provider)).toEqual(["photoprism"]);
    expect(immichSearch).not.toHaveBeenCalled();
  });

  it("the sources route lists what is connected without contacting a library", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await get("photos/sources", {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sources: ["photoprism"] });
    expect(ppSearch).not.toHaveBeenCalled();
    getPhotoprismConnection.mockResolvedValue(null);
    expect((await get("photos/sources", {})).body).toEqual({ sources: [] });
  });
});

import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { Readable } from "node:stream";

const searchAssetsByDate =
  jest.fn<(range: { takenAfter: Date; takenBefore: Date }) => Promise<unknown>>();
const fetchAssetStream = jest.fn<(id: string, size: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichClient", () => ({
  createImmichClient: () => ({ searchAssetsByDate, fetchAssetStream }),
}));
const getImmichConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichResolver", () => ({
  getImmichConnection: (userId: string) => getImmichConnection(userId),
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
 * `GET /travtrack/photos` and the thumbnail route (TravTrack plan T5.3): the
 * window's Immich photos placed by TIME on the privacy-safe track — never by
 * their EXIF — and only where the track places them. A photo inside a zone,
 * in a deleted span or between two stretches is not returned at all, and its
 * thumbnail is 404. Failures answer in the Immich kind vocabulary.
 */

const PREFIX = "travtrack-photos-";
const T = Date.parse("2026-10-10T12:00:00Z");
const MIN = 60_000;
const WINDOW = {
  from: new Date(T - 60 * MIN).toISOString(),
  to: new Date(T + 120 * MIN).toISOString(),
};
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const asset = (n: number, atMs: number) => ({
  id: ID(n),
  type: "IMAGE",
  fileCreatedAt: new Date(atMs).toISOString(),
  originalFileName: `${n}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  // An EXIF position far away: the answer must never carry it.
  lat: -33.9,
  lon: 151.2,
});

describe("TravTrack — photos on the track", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const photos = (query: Record<string, string> = WINDOW) =>
    request(app).get("/api/v1/travtrack/photos").query(query).set("Cookie", cookie);
  const file = (n: number, query: Record<string, string> = WINDOW) =>
    request(app)
      .get(`/api/v1/travtrack/photos/${ID(n)}/file`)
      .query(query)
      .set("Cookie", cookie);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    clearTravTrackPhotoCache();
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue({
      baseUrl: "http://immich.test",
      apiKey: "k",
      source: "user",
    });
    searchAssetsByDate.mockReset();
    fetchAssetStream.mockReset();
    fetchAssetStream.mockImplementation(async () => ({
      stream: Readable.from([Buffer.from("img")]),
      contentType: "image/webp",
      contentLength: 3,
    }));
    // One stretch: west at T, east at T+10'.
    await storePoint(userId, { t: T, lat: 37.5, lon: 127.0 });
    await storePoint(userId, { t: T + 10 * MIN, lat: 37.5, lon: 127.02 });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("places a photo on the track by its time, never by its EXIF", async () => {
    searchAssetsByDate.mockResolvedValue({ assets: [asset(1, T + 5 * MIN)], truncated: false });

    const res = await photos();

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.photos[0]).toMatchObject({
      assetId: ID(1),
      type: "IMAGE",
      takenAt: new Date(T + 5 * MIN).toISOString(),
    });
    expect(res.body.photos[0].lat).toBeCloseTo(37.5, 6);
    expect(res.body.photos[0].lon).toBeCloseTo(127.01, 6);
  });

  it("leaves out a photo outside every stretch: before, after and between them", async () => {
    await storePoint(userId, { t: T + 90 * MIN, lat: 37.6, lon: 127.1 });
    await storePoint(userId, { t: T + 95 * MIN, lat: 37.6, lon: 127.11 });
    // A deleted span between the two stretches.
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date(T + 20 * MIN), toAt: new Date(T + 80 * MIN) },
    });
    searchAssetsByDate.mockResolvedValue({
      assets: [asset(1, T - 30 * MIN), asset(2, T + 50 * MIN), asset(3, T + 110 * MIN)],
      truncated: false,
    });

    const res = await photos();

    expect(res.body.photos).toEqual([]);
  });

  it("leaves out a photo whose time falls in a privacy zone, and its thumbnail is 404", async () => {
    await wipeTravTrack([userId]);
    // West, inside the zone, east: the zone's vertex goes and the line breaks there.
    await storePoint(userId, { t: T, lat: 37.5, lon: 126.98 });
    await storePoint(userId, { t: T + 5 * MIN, lat: 37.5, lon: 127.0 });
    await storePoint(userId, { t: T + 10 * MIN, lat: 37.5, lon: 127.02 });
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5, lon: 127.0, radiusM: 300 },
    });
    searchAssetsByDate.mockResolvedValue({
      assets: [asset(1, T + 4 * MIN), asset(2, T + 5 * MIN), asset(3, T + 6 * MIN)],
      truncated: false,
    });

    const res = await photos();

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([]);
    expect((await file(2)).status).toBe(404);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("streams a placed photo's thumbnail, and only a rendition", async () => {
    searchAssetsByDate.mockResolvedValue({ assets: [asset(1, T + 5 * MIN)], truncated: false });

    const res = await file(1);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=86400, immutable");
    expect(fetchAssetStream).toHaveBeenCalledWith(ID(1), "thumbnail");
    expect((await file(1, { ...WINDOW, size: "original" })).status).toBe(400);
    // An asset the window does not place.
    expect((await file(4)).status).toBe(404);
  });

  it("no Immich connection → 409 notConfigured", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await photos();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
  });

  it("an Immich failure answers 502 with its kind", async () => {
    searchAssetsByDate.mockRejectedValue(new ImmichError("unreachable", "down"));
    const res = await photos();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("unreachable");
  });

  it("refuses a window over seven days", async () => {
    const res = await photos({
      from: new Date(T).toISOString(),
      to: new Date(T + 8 * 86_400_000).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAVTRACK_PHOTO_WINDOW_TOO_LONG");
  });

  it("TravTrack off → 403", async () => {
    await switches.set({ beta: true, config: false });
    expect((await photos()).status).toBe(403);
  });
});

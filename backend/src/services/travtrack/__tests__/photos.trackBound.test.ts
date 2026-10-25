import { prisma } from "../../../db";
import type { ImmichConnection } from "../../immich/types";
import { clearTravTrackPhotoCache, photoInWindow, travTrackPhotos } from "../photos";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * When the window's track is longer than the photo read's page bound, the
 * photos after the read part cannot be placed. That must be SAID
 * (`truncated`, `trackTruncated`), never answered as a complete list, and the
 * thumbnail grant must agree with the list it answered.
 */

const PREFIX = "travtrack-photos-bound-";
const T = Date.parse("2026-10-10T12:00:00Z");
const MIN = 60_000;
const WINDOW = { fromMs: T - 60 * MIN, untilMs: T + 120 * MIN };
const conn = { baseUrl: "http://immich.test", apiKey: "k", source: "user" } as ImmichConnection;

const asset = (id: string, atMs: number) => ({
  id,
  type: "IMAGE" as const,
  fileCreatedAt: new Date(atMs).toISOString(),
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: null,
  lon: null,
});

describe("TravTrack photos — the track read's bound", () => {
  let userId: string;
  const deps = (readLimits?: { page: number; pages: number }) => ({
    connection: async () => conn,
    client: () => ({
      searchAssetsByDate: async () => ({
        assets: [asset("early", T + 5 * MIN), asset("late", T + 45 * MIN)],
        truncated: false,
      }),
    }),
    readLimits,
  });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId]);
    clearTravTrackPhotoCache();
    // One stretch, a fix every ten minutes for an hour.
    for (let i = 0; i <= 6; i++) {
      await storePoint(userId, { t: T + i * 10 * MIN, lat: 37.5, lon: 127 + i * 0.01 });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a fully read track answers both photos and no truncation", async () => {
    const res = await travTrackPhotos(userId, WINDOW, deps());
    expect(res.photos.map((p) => p.assetId)).toEqual(["early", "late"]);
    expect(res).toMatchObject({ truncated: false, trackTruncated: false });
  });

  it("an exhausted page bound says so, and the grant follows the list", async () => {
    const limited = deps({ page: 2, pages: 1 });

    const res = await travTrackPhotos(userId, WINDOW, limited);

    expect(res.photos.map((p) => p.assetId)).toEqual(["early"]);
    expect(res).toMatchObject({ truncated: true, trackTruncated: true });
    expect(await photoInWindow(userId, WINDOW, "early", limited)).toBe(true);
    expect(await photoInWindow(userId, WINDOW, "late", limited)).toBe(false);
  });
});

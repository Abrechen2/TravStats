import { prisma } from "../../../db";
import { ImmichError, type ImmichConnection } from "../../immich/types";
import type { PhotoSourceAsset, PhotoSourceKind } from "../../photoSource/types";
import {
  PhotoSourcesFailed,
  PhotosNotConfigured,
  clearTravTrackPhotoCache,
  photoInWindow,
  travTrackPhotos,
} from "../photos";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * The window's photos from SEVERAL sources (Immich + PhotoPrism) and the
 * trips' linked albums: merged and deduped per provider + asset id, placed by
 * capture TIME on the safe track (never by the asset's own coordinates), a
 * photo in a privacy zone never returned, and one source failing leaves the
 * other's photos in place.
 */

const PREFIX = "travtrack-photos-sources-";
const T = Date.parse("2026-10-10T12:00:00Z");
const MIN = 60_000;
const WINDOW = { fromMs: T - 60 * MIN, untilMs: T + 120 * MIN };
const conn = (baseUrl: string) => ({ baseUrl, apiKey: "k", source: "user" }) as ImmichConnection;
const BOTH = async () => ({
  immich: conn("http://immich.test"),
  photoprism: conn("http://pp.test"),
});
const HASH = (c: string) => c.repeat(40);

const asset = (
  id: string,
  atMs: number,
  over: Partial<PhotoSourceAsset> = {}
): PhotoSourceAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: new Date(atMs).toISOString(),
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  // An EXIF position far away: the answer must never carry it.
  lat: -33.9,
  lon: 151.2,
  ...over,
});

type Script = {
  search?: PhotoSourceAsset[] | ImmichError;
  albums?: Record<string, PhotoSourceAsset[] | ImmichError>;
};
const sourceOf = (scripts: Partial<Record<PhotoSourceKind, Script>>) => {
  const albumReads: string[] = [];
  const source = (kind: PhotoSourceKind) => ({
    searchAssetsByTime: async () => {
      const s = scripts[kind]?.search ?? [];
      if (s instanceof Error) throw s;
      return { assets: s, truncated: false };
    },
    listAlbumAssets: async (albumId: string) => {
      albumReads.push(`${kind}:${albumId}`);
      const a = scripts[kind]?.albums?.[albumId] ?? [];
      if (a instanceof Error) throw a;
      return { assets: a, nextPage: null, truncated: false };
    },
  });
  return { source, albumReads };
};

describe("TravTrack photos — several sources and linked albums", () => {
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.trip.deleteMany({ where: { userId } });
    clearTravTrackPhotoCache();
    // One stretch: west at T, east at T+10'.
    await storePoint(userId, { t: T, lat: 37.5, lon: 127.0 });
    await storePoint(userId, { t: T + 10 * MIN, lat: 37.5, lon: 127.02 });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const run = (scripts: Partial<Record<PhotoSourceKind, Script>>) => {
    const s = sourceOf(scripts);
    return { s, promise: travTrackPhotos(userId, WINDOW, { connections: BOTH, source: s.source }) };
  };

  it("places a PhotoPrism photo on the track by its time, never by its EXIF", async () => {
    const { promise } = run({ photoprism: { search: [asset(HASH("a"), T + 5 * MIN)] } });

    const res = await promise;

    expect(res.photos).toHaveLength(1);
    expect(res.photos[0]).toMatchObject({ provider: "photoprism", assetId: HASH("a") });
    expect(res.photos[0].lat).toBeCloseTo(37.5, 6);
    expect(res.photos[0].lon).toBeCloseTo(127.01, 6);
  });

  it("a photo without a capture time (null) is never placed on the map, from either source", async () => {
    const { promise } = run({
      immich: { search: [asset("u", T, { fileCreatedAt: null })] },
      photoprism: {
        search: [asset(HASH("a"), T, { fileCreatedAt: null }), asset(HASH("b"), T + 5 * MIN)],
      },
    });
    expect((await promise).photos.map((p) => p.assetId)).toEqual([HASH("b")]);
  });

  it("merges both sources; the same id on two providers stays two photos", async () => {
    const { promise } = run({
      immich: { search: [asset("same", T + 3 * MIN)] },
      photoprism: { search: [asset("same", T + 3 * MIN), asset(HASH("c"), T + 6 * MIN)] },
    });

    const res = await promise;

    expect(res.photos.map((p) => `${p.provider}:${p.assetId}`)).toEqual([
      "immich:same",
      "photoprism:same",
      `photoprism:${HASH("c")}`,
    ]);
    expect(
      await photoInWindow(userId, WINDOW, "photoprism", HASH("c"), {
        connections: BOTH,
        source: sourceOf({ photoprism: { search: [asset(HASH("c"), T + 6 * MIN)] } }).source,
      })
    ).toBe(true);
  });

  it("a linked album's photo shows even when the library search misses it, and a photo in both is listed once", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Seoul",
        startDate: new Date(T - 2 * 86_400_000),
        endDate: new Date(T + 2 * 86_400_000),
      },
    });
    await prisma.tripImmichAlbum.createMany({
      data: [
        { tripId: trip.id, immichAlbumId: "al-i", provider: "immich", albumName: "I" },
        { tripId: trip.id, immichAlbumId: "al-p", provider: "photoprism", albumName: "P" },
      ],
    });
    const s = sourceOf({
      immich: {
        search: [asset("both", T + 2 * MIN)],
        albums: { "al-i": [asset("both", T + 2 * MIN), asset("only-album", T + 4 * MIN)] },
      },
      photoprism: { albums: { "al-p": [asset(HASH("d"), T + 6 * MIN)] } },
    });

    const res = await travTrackPhotos(userId, WINDOW, { connections: BOTH, source: s.source });

    expect(res.photos.map((p) => `${p.provider}:${p.assetId}`)).toEqual([
      "immich:both",
      "immich:only-album",
      `photoprism:${HASH("d")}`,
    ]);
    expect(s.albumReads.sort()).toEqual(["immich:al-i", "photoprism:al-p"]);
  });

  it("does not read the albums of a trip that is not on the window's days", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Elsewhere",
        startDate: new Date(T - 90 * 86_400_000),
        endDate: new Date(T - 80 * 86_400_000),
      },
    });
    await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "al-old", provider: "immich", albumName: "Old" },
    });
    const s = sourceOf({ immich: { albums: { "al-old": [asset("x", T + 4 * MIN)] } } });

    const res = await travTrackPhotos(userId, WINDOW, { connections: BOTH, source: s.source });

    expect(res.photos).toEqual([]);
    expect(s.albumReads).toEqual([]);
  });

  it("leaves out a photo whose time falls in a privacy zone, whichever source holds it", async () => {
    await wipeTravTrack([userId]);
    await storePoint(userId, { t: T, lat: 37.5, lon: 126.98 });
    await storePoint(userId, { t: T + 5 * MIN, lat: 37.5, lon: 127.0 });
    await storePoint(userId, { t: T + 10 * MIN, lat: 37.5, lon: 127.02 });
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5, lon: 127.0, radiusM: 300 },
    });
    const { promise } = run({
      immich: { search: [asset("i", T + 5 * MIN)] },
      photoprism: { search: [asset(HASH("e"), T + 5 * MIN)] },
    });

    expect((await promise).photos).toEqual([]);
  });

  it("one source failing is reported by name while the other's photos still show", async () => {
    const { promise } = run({
      immich: { search: [asset("ok", T + 5 * MIN)] },
      photoprism: { search: new ImmichError("auth", "rejected") },
    });

    const res = await promise;

    expect(res.photos.map((p) => p.assetId)).toEqual(["ok"]);
    expect(res.failures).toEqual([{ provider: "photoprism", kind: "auth" }]);
  });

  it("an album that cannot be read is reported, and the search's photos stay", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Seoul", startDate: new Date(T - 86_400_000), endDate: new Date(T) },
    });
    await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "al-p", provider: "photoprism", albumName: "P" },
    });
    const { promise } = run({
      photoprism: {
        search: [asset(HASH("f"), T + 5 * MIN)],
        albums: { "al-p": new ImmichError("notFound", "gone") },
      },
    });

    const res = await promise;

    expect(res.photos).toHaveLength(1);
    expect(res.failures).toEqual([{ provider: "photoprism", kind: "notFound" }]);
  });

  it("a deleted linked album does not turn an answered, empty search into a failure", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Seoul", startDate: new Date(T - 86_400_000), endDate: new Date(T) },
    });
    await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "al-i", provider: "immich", albumName: "I" },
    });
    const s = sourceOf({ immich: { albums: { "al-i": new ImmichError("notFound", "gone") } } });

    const res = await travTrackPhotos(userId, WINDOW, {
      connections: async () => ({ immich: conn("http://immich.test") }),
      source: s.source,
    });

    expect(res.photos).toEqual([]);
    expect(res.failures).toEqual([{ provider: "immich", kind: "notFound" }]);
  });

  it("more linked albums than are read says so instead of dropping them silently", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Seoul", startDate: new Date(T - 86_400_000), endDate: new Date(T) },
    });
    await prisma.tripImmichAlbum.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        tripId: trip.id,
        immichAlbumId: `al-${String(i).padStart(2, "0")}`,
        provider: "immich",
        albumName: `A${i}`,
      })),
    });
    const s = sourceOf({});

    const res = await travTrackPhotos(userId, WINDOW, {
      connections: async () => ({ immich: conn("http://immich.test") }),
      source: s.source,
    });

    expect(s.albumReads).toHaveLength(20);
    expect(res.truncated).toBe(true);
  });

  it("every source failing with nothing to show throws, carrying each failure", async () => {
    const { promise } = run({
      immich: { search: new ImmichError("unreachable", "down") },
      photoprism: { search: new ImmichError("auth", "rejected") },
    });

    await expect(promise).rejects.toMatchObject({
      failures: [
        { provider: "immich", kind: "unreachable" },
        { provider: "photoprism", kind: "auth" },
      ],
    });
    await expect(promise).rejects.toBeInstanceOf(PhotoSourcesFailed);
  });

  it("no connection at all is not configured", async () => {
    await expect(
      travTrackPhotos(userId, WINDOW, { connections: async () => ({}) })
    ).rejects.toBeInstanceOf(PhotosNotConfigured);
  });
});

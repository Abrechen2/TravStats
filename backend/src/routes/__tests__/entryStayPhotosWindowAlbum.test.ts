import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

type Asset = Record<string, unknown> & { id: string; fileCreatedAt: string };
const library = { all: [] as Asset[], album: [] as Asset[] };
jest.mock("../../services/photoSource", () => {
  const actual = jest.requireActual("../../services/photoSource") as object;
  return {
    ...actual,
    createPhotoSource: (kind: "immich" | "photoprism") => ({
      kind,
      // Like a real source: only what falls inside the asked window comes back.
      searchAssetsByTime: async (range: { takenAfter: Date; takenBefore: Date }) => ({
        assets:
          kind === "immich"
            ? library.all.filter((a) => {
                const at = Date.parse(a.fileCreatedAt);
                return at >= range.takenAfter.getTime() && at <= range.takenBefore.getTime();
              })
            : [],
        truncated: false,
      }),
      listAlbums: async () => [{ id: "album-1", albumName: "Rome 2024", assetCount: 3 }],
      listAlbumAssets: async () => ({ assets: library.album, nextPage: null, truncated: false }),
    }),
  };
});
jest.mock("../../services/photoSource/connection", () => {
  const actual = jest.requireActual("../../services/photoSource/connection") as object;
  return {
    ...actual,
    getPhotoSourceConnection: async (kind: "immich" | "photoprism") =>
      kind === "immich" ? { baseUrl: "http://immich.test", apiKey: "k", source: "user" } : null,
  };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A stay's photos: the window is the whole check-in day through the whole check-out day in the
 * stay's zone (a camera roll does not start at 15:00), the list says how many candidates there
 * are and how many it shows, and "Aus Album wählen" narrows the candidates to one album.
 */
const ROME = { lat: 41.9009, lon: 12.4833 };
const aid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const photo = (n: number, iso: string, over: Record<string, unknown> = {}): Asset => ({
  id: aid(n),
  type: "IMAGE",
  fileCreatedAt: iso,
  originalFileName: `${n}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  lat: 41.9011,
  lon: 12.4835,
  ...over,
});

// Check-in 15:00 and check-out 11:00 Rome time (CEST, UTC+2).
const MORNING_OF_CHECK_IN = photo(1, "2024-05-01T05:00:00.000Z"); // 07:00 Rome, before check-in
const JUST_AFTER_MIDNIGHT = photo(2, "2024-04-30T22:30:00.000Z"); // 00:30 Rome on 1 May
const MIDDLE = photo(3, "2024-05-02T10:00:00.000Z");
const EVENING_OF_CHECK_OUT = photo(4, "2024-05-04T17:00:00.000Z"); // 19:00 Rome, after check-out
const NEXT_DAY = photo(5, "2024-05-05T07:00:00.000Z"); // 09:00 Rome on 5 May
const DAY_BEFORE = photo(6, "2024-04-30T21:00:00.000Z"); // 23:00 Rome on 30 April

describe("stay photos: window, count, album", () => {
  const stamp = Date.now();
  let cookie: string;
  let userId: string;
  let stayId: string;
  const choices = (query = "") =>
    request(app)
      .get(`/api/v1/entry-photos/stay/${stayId}/photo-choices${query}`)
      .set("Cookie", cookie);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `spw-${stamp}`, passwordHash } });
    userId = user.id;
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {} },
      update: {},
    });
    cookie = `auth_token=${generateToken(userId)}`;
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel", lat: ROME.lat, lon: ROME.lon },
    });
    stayId = (
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkInAt: new Date("2024-05-01T13:00:00Z"),
          checkOutAt: new Date("2024-05-04T09:00:00Z"),
          checkInDate: new Date("2024-05-01"),
          checkOutDate: new Date("2024-05-04"),
          stayZone: "Europe/Rome",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: "spw-" } } });
  });
  beforeEach(async () => {
    clearImmichAssetCache();
    await prisma.entryPhotoLink.deleteMany({ where: { userId } });
    library.all = [
      MORNING_OF_CHECK_IN,
      JUST_AFTER_MIDNIGHT,
      MIDDLE,
      EVENING_OF_CHECK_OUT,
      NEXT_DAY,
      DAY_BEFORE,
    ];
    library.album = [
      MIDDLE,
      NEXT_DAY,
      photo(7, "2024-05-03T10:00:00.000Z", { lat: null, lon: null }),
    ];
  });

  it("the candidate window covers the check-in day through the check-out day in the stay's zone", async () => {
    const res = await choices();
    const ids = res.body.data.choices.map((c: { assetId: string }) => c.assetId);
    expect(ids).toEqual([
      JUST_AFTER_MIDNIGHT.id,
      MORNING_OF_CHECK_IN.id,
      MIDDLE.id,
      EVENING_OF_CHECK_OUT.id,
    ]);
    expect(res.body.data.window).toEqual({ from: "2024-05-01", to: "2024-05-04" });
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.thinned).toBe(false);
  });

  it("a long camera roll is never cut silently: the list says total and thinned, 'all' lists every one", async () => {
    library.all = Array.from({ length: 90 }, (_, i) =>
      photo(100 + i, new Date(Date.UTC(2024, 4, 2, 6, 0) + i * 60_000).toISOString())
    );
    const thin = await choices();
    expect(thin.body.data.choices).toHaveLength(60);
    expect(thin.body.data.total).toBe(90);
    expect(thin.body.data.thinned).toBe(true);
    const all = await choices("?all=1");
    expect(all.body.data.choices).toHaveLength(90);
    expect(all.body.data.thinned).toBe(false);
  });

  it("lists the albums of the source for the stay", async () => {
    const res = await request(app)
      .get(`/api/v1/entry-photos/stay/${stayId}/photo-albums?provider=immich`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.albums).toEqual([
      { id: "album-1", albumName: "Rome 2024", assetCount: 3 },
    ]);
    const none = await request(app)
      .get(`/api/v1/entry-photos/stay/${stayId}/photo-albums?provider=photoprism`)
      .set("Cookie", cookie);
    expect(none.status).toBe(409);
    expect(none.body.error).toBe("notConfigured");
  });

  it("album pick: the candidates are the album's photos inside the stay's dates", async () => {
    const res = await choices("?provider=immich&albumId=album-1");
    const ids = res.body.data.choices.map((c: { assetId: string }) => c.assetId);
    expect(ids).toEqual([MIDDLE.id, aid(7)].sort((a, b) => (a === MIDDLE.id ? -1 : 1)));
    expect(ids).not.toContain(NEXT_DAY.id);
    expect(res.body.data.album).toEqual({ provider: "immich", albumId: "album-1", anyDate: false });
  });

  it("album pick with the toggle: regardless of the stay's dates", async () => {
    const res = await choices("?provider=immich&albumId=album-1&anyDate=1");
    const ids = res.body.data.choices.map((c: { assetId: string }) => c.assetId);
    expect(ids).toContain(NEXT_DAY.id);
    expect(ids).toHaveLength(3);
  });

  it("choosing from an album links only that album's photos; a photo outside it is skipped, nothing is auto-linked", async () => {
    const album = { provider: "immich", albumId: "album-1", anyDate: false };
    const put = await request(app)
      .put(`/api/v1/entry-photos/stay/${stayId}/photo-choices`)
      .set("Cookie", cookie)
      .send({
        album,
        select: [
          { provider: "immich", assetId: MIDDLE.id },
          { provider: "immich", assetId: MORNING_OF_CHECK_IN.id },
        ],
      });
    expect(put.body.data).toEqual({ picked: 1, swapped: 0, refused: 0, skipped: 1 });
    const rows = await prisma.entryPhotoLink.findMany({ where: { userId, lodgingStayId: stayId } });
    expect(rows.map((r) => [r.assetId, r.provenance])).toEqual([[MIDDLE.id, "manual"]]);
  });

  it("an album that cannot be read says why instead of listing nothing", async () => {
    const res = await choices("?provider=photoprism&albumId=x");
    expect(res.body.data.sources.photoprism).toBe("notConfigured");
    expect(res.body.data.choices).toEqual([]);
  });
});

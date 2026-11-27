import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { Readable } from "node:stream";

type Kind = "immich" | "photoprism";
type Asset = Record<string, unknown> & { id: string; fileCreatedAt: string | null };
type Album = {
  id: string;
  albumName: string;
  assetCount: number | null;
  kind?: string;
  year?: number | null;
};
interface Library {
  connected: boolean;
  search: Asset[];
  albums: Album[];
  albumAssets: Record<string, Asset[]>;
  /** A failure kind every read throws, or null. */
  fail: string | null;
}
const lib: Record<Kind, Library> = {
  immich: { connected: true, search: [], albums: [], albumAssets: {}, fail: null },
  photoprism: { connected: true, search: [], albums: [], albumAssets: {}, fail: null },
};

jest.mock("../../services/photoSource", () => {
  const actual = jest.requireActual("../../services/photoSource") as object;
  const { ImmichError } = jest.requireActual("../../services/immich/types") as {
    ImmichError: new (kind: string, message: string) => Error;
  };
  const guard = (kind: Kind) => {
    if (lib[kind].fail) throw new ImmichError(lib[kind].fail!, "down");
  };
  return {
    ...actual,
    createPhotoSource: (kind: Kind) => ({
      kind,
      searchAssetsByTime: async (range: { takenAfter: Date; takenBefore: Date }) => {
        guard(kind);
        return {
          assets: lib[kind].search.filter((a) => {
            const at = Date.parse(a.fileCreatedAt ?? "");
            // A real source answers a day wider on both ends; the server must re-check.
            return (
              at >= range.takenAfter.getTime() - 86_400_000 &&
              at <= range.takenBefore.getTime() + 86_400_000
            );
          }),
          truncated: false,
        };
      },
      listAlbums: async () => {
        guard(kind);
        return lib[kind].albums;
      },
      listAlbumAssets: async (albumId: string) => {
        guard(kind);
        return { assets: lib[kind].albumAssets[albumId] ?? [], nextPage: null, truncated: false };
      },
      streamThumbnail: async () => ({
        stream: Readable.from([Buffer.from("jpeg")]),
        contentType: "image/jpeg",
        contentLength: 4,
      }),
    }),
  };
});
jest.mock("../../services/photoSource/connection", () => {
  const actual = jest.requireActual("../../services/photoSource/connection") as object;
  return {
    ...actual,
    getPhotoSourceConnection: async (kind: Kind) =>
      lib[kind].connected ? { baseUrl: `http://${kind}.test`, apiKey: "k", source: "user" } : null,
  };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Trip photo links (spec 2026-11-26-trip-photo-links.md): period links read PhotoPrism (Immich
 * only as the fallback), an Immich album's twins of PhotoPrism photos are dropped, album
 * proposals and the business offer appear on the trip only, failures reach the caller as
 * themselves, and nothing is ever copied.
 */
const OWNER = "tps-owner";
const OTHER = "tps-other";
const hex = (n: number) => n.toString(16).padStart(32, "0");
const asset = (id: string, iso: string | null, over: Record<string, unknown> = {}): Asset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: iso,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  lat: null,
  lon: null,
  width: 4000,
  height: 3000,
  ...over,
});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Münster, 10–12 Feb 2017 (Berlin zone, profile zone UTC in this suite).
const IN_TRIP = asset(hex(1), "2017-02-10T09:00:00.000Z");
const IN_TRIP_2 = asset(hex(2), "2017-02-12T15:00:00.000Z");
const DAY_BEFORE = asset(hex(3), "2017-02-09T12:00:00.000Z");
const IMMICH_TWIN = asset(uuid(1), "2017-02-10T09:00:01.000Z", { width: 3000, height: 4000 });
const IMMICH_OWN = asset(uuid(2), "2017-02-11T08:00:00.000Z");

describe("trip photo links", () => {
  let ownerId: string;
  let cookie: string;
  let otherCookie: string;
  let tripId: string;

  const newTrip = (over: Record<string, unknown> = {}) =>
    prisma.trip.create({
      data: {
        userId: ownerId,
        name: "Münster",
        startDay: new Date("2017-02-10T00:00:00Z"),
        endDay: new Date("2017-02-12T00:00:00Z"),
        ...over,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, OTHER] } } });
    const [a, b] = await Promise.all(
      [OWNER, OTHER].map(async (username) =>
        prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } })
      )
    );
    ownerId = a.id;
    cookie = `auth_token=${generateToken(a.id)}`;
    otherCookie = `auth_token=${generateToken(b.id)}`;
  });

  beforeEach(async () => {
    clearImmichAssetCache();
    for (const k of ["immich", "photoprism"] as Kind[]) {
      lib[k] = { connected: true, search: [], albums: [], albumAssets: {}, fail: null };
    }
    await prisma.trip.deleteMany({ where: { userId: ownerId } });
    await prisma.userSettings.deleteMany({ where: { userId: ownerId } });
    tripId = (await newTrip()).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, OTHER] } } });
    await prisma.$disconnect();
  });

  const addPeriod = (body: Record<string, unknown> = {}) =>
    request(app)
      .post(`/api/v1/trips/${tripId}/photo-sources`)
      .set("Cookie", cookie)
      .send({ kind: "period", ...body });
  const photos = (query = "") =>
    request(app).get(`/api/v1/trips/${tripId}/linked-photos${query}`).set("Cookie", cookie);
  const proposals = () =>
    request(app).get(`/api/v1/trips/${tripId}/photo-sources/proposals`).set("Cookie", cookie);

  describe("period link", () => {
    it("reads PhotoPrism for the trip's days only and stores no photo", async () => {
      lib.photoprism.search = [IN_TRIP, IN_TRIP_2, DAY_BEFORE];
      lib.immich.search = [IMMICH_OWN];
      const added = await addPeriod();
      expect(added.status).toBe(201);
      expect(added.body.source).toMatchObject({
        kind: "period",
        provider: "photoprism",
        from: "2017-02-10",
        until: "2017-02-12",
        pinned: false,
      });

      const res = await photos();
      expect(res.status).toBe(200);
      expect(res.body.photos.map((p: { key: string }) => p.key)).toEqual([
        `photoprism:${IN_TRIP.id}`,
        `photoprism:${IN_TRIP_2.id}`,
      ]);
      expect(res.body.photos[0].url).toBe(
        `/api/v1/trips/${tripId}/photo-sources/${added.body.source.id}/assets/${IN_TRIP.id}/file?size=thumbnail`
      );
      expect(res.body.days).toEqual([
        { day: "2017-02-10", count: 1 },
        { day: "2017-02-12", count: 1 },
      ]);
      // References only: no photo row was written.
      expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(0);
    });

    it("falls back to Immich only when PhotoPrism is not connected", async () => {
      lib.photoprism.connected = false;
      lib.immich.search = [IMMICH_OWN];
      const added = await addPeriod();
      expect(added.body.source.provider).toBe("immich");
      expect((await photos()).body.photos).toHaveLength(1);
    });

    it("refuses an Immich period while PhotoPrism is connected", async () => {
      const res = await addPeriod({ connectionId: "immich" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("notPreferred");
    });

    it("follows the trip's dates unless pinned", async () => {
      lib.photoprism.search = [IN_TRIP, DAY_BEFORE];
      await addPeriod();
      await prisma.trip.update({
        where: { id: tripId },
        data: { startDay: new Date("2017-02-09T00:00:00Z") },
      });
      expect((await photos()).body.photos).toHaveLength(2);

      await addPeriod({ from: "2017-02-10", until: "2017-02-10" });
      clearImmichAssetCache();
      const res = await photos();
      expect(res.body.photos.map((p: { key: string }) => p.key)).toEqual([
        `photoprism:${IN_TRIP.id}`,
      ]);
      const listed = await request(app)
        .get(`/api/v1/trips/${tripId}/photo-sources`)
        .set("Cookie", cookie);
      expect(listed.body.sources[0]).toMatchObject({
        pinned: true,
        from: "2017-02-10",
        until: "2017-02-10",
      });
    });

    it("pages one day at a time", async () => {
      lib.photoprism.search = [IN_TRIP, IN_TRIP_2];
      await addPeriod();
      const first = await photos("?day=all&limit=1");
      expect(first.body).toMatchObject({ total: 2, totalAll: 2, nextCursor: "1" });
      const day = await photos("?day=2017-02-12");
      expect(day.body.photos.map((p: { key: string }) => p.key)).toEqual([
        `photoprism:${IN_TRIP_2.id}`,
      ]);
      expect((await photos("?day=yesterday")).status).toBe(400);
    });
  });

  describe("de-duplication", () => {
    it("drops an Immich album's twin of a PhotoPrism period photo and keeps the Immich-only one", async () => {
      lib.photoprism.search = [IN_TRIP];
      lib.immich.albumAssets["im-album"] = [IMMICH_TWIN, IMMICH_OWN];
      await prisma.tripImmichAlbum.create({
        data: {
          tripId,
          provider: "immich",
          immichAlbumId: "im-album",
          albumName: "Handy",
          mode: "link",
        },
      });
      await addPeriod();
      const keys = (await photos()).body.photos.map((p: { key: string }) => p.key);
      expect(keys).toEqual([`photoprism:${IN_TRIP.id}`, `immich:${IMMICH_OWN.id}`]);
    });
  });

  describe("failures stay visible", () => {
    it("names a failing source instead of answering fewer photos in silence", async () => {
      lib.immich.albumAssets["im-album"] = [IMMICH_OWN];
      await prisma.tripImmichAlbum.create({
        data: {
          tripId,
          provider: "immich",
          immichAlbumId: "im-album",
          albumName: "Handy",
          mode: "link",
        },
      });
      const period = await addPeriod();
      lib.photoprism.fail = "unreachable";
      const res = await photos();
      expect(res.status).toBe(200);
      expect(res.body.photos).toHaveLength(1);
      expect(res.body.failures).toEqual([
        {
          sourceId: period.body.source.id,
          sourceKind: "period",
          provider: "photoprism",
          kind: "unreachable",
        },
      ]);
      const prop = await proposals();
      expect(prop.body.failure).toBe("unreachable");
    });

    it("says notConfigured for a period whose source was disconnected", async () => {
      await addPeriod();
      lib.photoprism.connected = false;
      lib.immich.connected = false;
      const res = await photos();
      expect(res.body.failures[0].kind).toBe("notConfigured");
    });
  });

  describe("proposals", () => {
    beforeEach(() => {
      lib.photoprism.albums = [
        { id: "f2017", albumName: "2017_Münster", assetCount: null, kind: "folder" },
        { id: "f2019", albumName: "2019_Münster", assetCount: null, kind: "folder" },
        { id: "a-name", albumName: "Muenster Kongress", assetCount: 12, kind: "album" },
        {
          id: "a-date",
          albumName: "Februar Wochenende",
          assetCount: null,
          kind: "album",
          year: 2017,
        },
        { id: "a-year", albumName: "Alles 2017", assetCount: null, kind: "album", year: 2017 },
        { id: "m", albumName: "Februar 2017", assetCount: null, kind: "month", year: 2017 },
      ];
      lib.photoprism.albumAssets = {
        f2017: [IN_TRIP, IN_TRIP_2],
        "a-name": [IN_TRIP],
        "a-date": [IN_TRIP, IN_TRIP_2],
        // A year's album spans far more than the trip: never a date proposal.
        "a-year": [
          asset(hex(9), "2017-01-01T10:00:00Z"),
          IN_TRIP,
          asset(hex(10), "2017-12-30T10:00:00Z"),
        ],
      };
    });

    it("proposes by folder, name and date, never another year or a calendar slice", async () => {
      const res = await proposals();
      expect(res.status).toBe(200);
      expect(res.body.connectionId).toBe("photoprism");
      expect(
        res.body.proposals.map((p: { albumId: string; reason: string }) => [p.albumId, p.reason])
      ).toEqual([
        ["f2017", "folder"],
        ["a-name", "name"],
        ["a-date", "date"],
      ]);
      expect(res.body.proposals[0]).toMatchObject({
        count: 2,
        overlapDays: 3,
        key: "photoprism:f2017",
      });
      // A hint only: nothing was linked, and no inbox row was written.
      expect(await prisma.tripImmichAlbum.count({ where: { tripId } })).toBe(0);
    });

    it("drops a name match whose photos lie outside the trip", async () => {
      lib.photoprism.albumAssets["a-name"] = [asset(hex(11), "2018-06-01T10:00:00Z")];
      const ids = (await proposals()).body.proposals.map((p: { albumId: string }) => p.albumId);
      expect(ids).not.toContain("a-name");
    });

    it("remembers 'nicht dieses' and links on click", async () => {
      const dismissed = await request(app)
        .post(`/api/v1/trips/${tripId}/photo-sources/proposals/photoprism:f2017/dismiss`)
        .set("Cookie", cookie);
      expect(dismissed.status).toBe(204);
      const linked = await request(app)
        .post(`/api/v1/trips/${tripId}/photo-sources`)
        .set("Cookie", cookie)
        .send({ kind: "album", connectionId: "photoprism", albumId: "a-name" });
      expect(linked.status).toBe(201);
      expect(linked.body.source).toMatchObject({
        kind: "album",
        mode: "link",
        name: "Muenster Kongress",
      });
      const ids = (await proposals()).body.proposals.map((p: { albumId: string }) => p.albumId);
      expect(ids).toEqual(["a-date"]);
    });

    it("refuses linking an album the library does not have", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/photo-sources`)
        .set("Cookie", cookie)
        .send({ kind: "album", connectionId: "photoprism", albumId: "nope" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unknownAlbum");
    });
  });

  describe("business trips and the auto setting", () => {
    it("offers the period on a business trip with no album, not on a holiday", async () => {
      expect((await proposals()).body.periodOffer).toBeNull();
      await prisma.trip.update({ where: { id: tripId }, data: { category: "business" } });
      expect((await proposals()).body.periodOffer).toEqual({
        connectionId: "photoprism",
        from: "2017-02-10",
        until: "2017-02-12",
      });
      // "Nicht jetzt" is remembered.
      await request(app)
        .post(`/api/v1/trips/${tripId}/photo-sources/proposals/period/dismiss`)
        .set("Cookie", cookie)
        .expect(204);
      expect((await proposals()).body.periodOffer).toBeNull();
    });

    it("links nothing on its own while the auto setting is off (the default)", async () => {
      const setting = await request(app)
        .get("/api/v1/settings/photo-period-auto")
        .set("Cookie", cookie);
      expect(setting.body).toEqual({ enabled: false });
      await proposals();
      expect(await prisma.tripPhotoPeriod.count({ where: { tripId } })).toBe(0);
    });

    it("links the period when the setting is on, and never again after the user removed it", async () => {
      await request(app)
        .put("/api/v1/settings/photo-period-auto")
        .set("Cookie", cookie)
        .send({ enabled: true })
        .expect(200);
      expect((await proposals()).body.autoLinked).toBe(true);
      const sources = await request(app)
        .get(`/api/v1/trips/${tripId}/photo-sources`)
        .set("Cookie", cookie);
      expect(sources.body.sources).toEqual([
        expect.objectContaining({ kind: "period", auto: true }),
      ]);
      await request(app)
        .delete(`/api/v1/trips/${tripId}/photo-sources/${sources.body.sources[0].id}`)
        .set("Cookie", cookie)
        .expect(204);
      expect((await proposals()).body.autoLinked).toBe(false);
      expect(await prisma.tripPhotoPeriod.count({ where: { tripId } })).toBe(0);
    });
  });

  describe("proxy and ownership", () => {
    it("streams a period photo and refuses an asset outside the period", async () => {
      lib.photoprism.search = [IN_TRIP, DAY_BEFORE];
      const { body } = await addPeriod();
      const base = `/api/v1/trips/${tripId}/photo-sources/${body.source.id}/assets`;
      const ok = await request(app)
        .get(`${base}/${IN_TRIP.id}/file?size=thumbnail`)
        .set("Cookie", cookie);
      expect(ok.status).toBe(200);
      expect(ok.headers["cache-control"]).toMatch(/private/);
      const outside = await request(app).get(`${base}/${DAY_BEFORE.id}/file`).set("Cookie", cookie);
      expect(outside.status).toBe(404);
      const foreign = await request(app)
        .get(`${base}/${IN_TRIP.id}/file`)
        .set("Cookie", otherCookie);
      expect(foreign.status).toBe(404);
    });

    it("hides another account's trip on every route", async () => {
      for (const path of ["photo-sources", "photo-sources/proposals", "linked-photos"]) {
        const res = await request(app)
          .get(`/api/v1/trips/${tripId}/${path}`)
          .set("Cookie", otherCookie);
        expect(res.status).toBe(404);
      }
    });
  });
});

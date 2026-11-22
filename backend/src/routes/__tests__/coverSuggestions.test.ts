/**
 * Cover suggestions end to end (real app and database, photo sources mocked —
 * a test never reaches a real Immich or PhotoPrism): the three suggestions and
 * their reasons, one source failing while the other still answers, abstention,
 * and the "Das bin ich" setting.
 */
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";

import type { PhotoSourceAsset, PhotoSourceKind } from "../../services/photoSource/types";
import { ImmichError } from "../../services/immich/types";

type SearchFn = (
  range: unknown,
  filter?: { personId?: string }
) => Promise<{ assets: PhotoSourceAsset[]; truncated: boolean }>;
const sources: Record<
  PhotoSourceKind,
  { search: jest.Mock<SearchFn>; people: jest.Mock<() => Promise<unknown>> }
> = {
  immich: { search: jest.fn<SearchFn>(), people: jest.fn<() => Promise<unknown>>() },
  photoprism: { search: jest.fn<SearchFn>(), people: jest.fn<() => Promise<unknown>>() },
};
const connected = new Set<PhotoSourceKind>(["immich", "photoprism"]);

jest.mock("../../services/photoSource", () => ({
  ...jest.requireActual<object>("../../services/photoSource"),
  createPhotoSource: (kind: PhotoSourceKind) => ({
    kind,
    searchAssetsByTime: sources[kind].search,
    listAlbumAssets: async () => ({ assets: [], nextPage: null, truncated: false }),
    listPeople: sources[kind].people,
  }),
}));
jest.mock("../../services/photoSource/connection", () => ({
  ...jest.requireActual<object>("../../services/photoSource/connection"),
  getPhotoSourceConnection: async (kind: PhotoSourceKind) =>
    connected.has(kind)
      ? { baseUrl: "http://x", apiKey: "k", source: "user", allowPrivate: true }
      : null,
}));

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

const asset = (id: string, over: Partial<PhotoSourceAsset> = {}): PhotoSourceAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-05-03T10:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat: null,
  lon: null,
  cameraMake: "Apple",
  ...over,
});

describe("cover suggestions", () => {
  const stamp = Date.now();
  let cookie: string;
  let userId: string;
  let tripId: string;
  let flightId: string;
  const get = () =>
    request(app).get(`/api/v1/trips/${tripId}/cover-suggestions`).set("Cookie", cookie);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `cover-${stamp}`, passwordHash: await hashPassword("test-password") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Lisbon",
        startDate: new Date("2026-05-01T00:00:00Z"),
        endDate: new Date("2026-05-05T00:00:00Z"),
      },
    });
    tripId = trip.id;
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel", type: "hotel", lat: 38.7, lon: -9.14 },
    });
    await prisma.lodgingStay.create({ data: { lodgingId: lodging.id, userId, tripId } });
    const flight = await prisma.flight.create({
      data: {
        userId,
        tripId,
        flightNumber: "TP1",
        depLat: 50,
        depLon: 8,
        arrLat: 38.7,
        arrLon: -9.1,
        departureTime: new Date("2026-05-01T08:00:00Z"),
      },
    });
    flightId = flight.id;
    // A photo reached only through the flight (no album, no copy).
    await prisma.entryPhotoLink.create({
      data: {
        userId,
        flightId,
        provider: "immich",
        assetId: "entry-photo",
        takenAt: new Date("2026-05-03T10:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: "cover-" } } });
  });

  beforeEach(async () => {
    connected.clear();
    connected.add("immich");
    connected.add("photoprism");
    for (const s of Object.values(sources)) {
      s.search.mockReset();
      s.people.mockReset();
      s.search.mockResolvedValue({ assets: [], truncated: false });
    }
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  it("ranks the photo with me, the hotel and a favourite first and says why", async () => {
    await prisma.userSettings.create({
      data: { userId, data: {}, immichSelfPersonId: "person-me" },
    });
    sources.immich.search.mockImplementation(async (_range, filter) => ({
      assets: filter?.personId
        ? [asset("entry-photo")]
        : [
            asset("entry-photo", { favorite: true, lat: 38.701, lon: -9.14 }),
            asset("plain", { lat: 40, lon: -8 }),
          ],
      truncated: false,
    }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.abstained).toBeNull();
    const top = res.body.suggestions[0];
    expect(top.reasons.map((r: { code: string }) => r.code)).toEqual([
      "me",
      "placeClose",
      "favorite",
    ]);
    expect(top.apply.type).toBe("entry");
    expect(top.thumbUrl).toContain(`/entry-photos/flight/${flightId}/photos/`);
    expect(res.body.sources).toContainEqual({ provider: "immich", photos: "ok", people: "ok" });
  });

  it("still suggests from PhotoPrism while Immich is down, and names the failure", async () => {
    sources.immich.search.mockRejectedValue(new ImmichError("unreachable", "down"));
    await prisma.entryPhotoLink.create({
      data: {
        userId,
        flightId,
        provider: "photoprism",
        assetId: "a".repeat(40),
        takenAt: new Date("2026-05-03T11:00:00Z"),
      },
    });
    sources.photoprism.search.mockResolvedValue({
      assets: [
        asset("a".repeat(40), {
          favorite: true,
          lat: 38.7,
          lon: -9.14,
          fileCreatedAt: "2026-05-03T11:00:00.000Z",
        }),
      ],
      truncated: false,
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.suggestions[0].key).toBe(`photoprism:${"a".repeat(40)}`);
    expect(res.body.sources).toContainEqual(
      expect.objectContaining({ provider: "immich", photos: "unreachable" })
    );
    expect(res.body.sources).toContainEqual(
      expect.objectContaining({ provider: "photoprism", photos: "ok" })
    );
    await prisma.entryPhotoLink.deleteMany({ where: { userId, provider: "photoprism" } });
  });

  it("keeps suggesting without the me-signal when only the people lookup fails", async () => {
    await prisma.userSettings.create({
      data: { userId, data: {}, immichSelfPersonId: "person-me" },
    });
    sources.immich.search.mockImplementation(async (_range, filter) => {
      if (filter?.personId) throw new ImmichError("auth", "nope");
      return {
        assets: [asset("entry-photo", { favorite: true, lat: 38.7, lon: -9.14 })],
        truncated: false,
      };
    });
    const res = await get();
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.suggestions[0].reasons.map((r: { code: string }) => r.code)).not.toContain(
      "me"
    );
    expect(res.body.sources).toContainEqual({ provider: "immich", photos: "ok", people: "auth" });
  });

  it("abstains instead of offering a photo that earns nothing", async () => {
    sources.immich.search.mockResolvedValue({ assets: [asset("entry-photo")], truncated: false });
    const res = await get();
    expect(res.body.suggestions).toEqual([]);
    expect(res.body.abstained).toBe("noneQualified");
  });

  it("abstains on a trip without dates", async () => {
    const undated = await prisma.trip.create({ data: { userId, name: "Someday" } });
    const res = await request(app)
      .get(`/api/v1/trips/${undated.id}/cover-suggestions`)
      .set("Cookie", cookie);
    expect(res.body).toEqual({ suggestions: [], abstained: "noTripDates", sources: [] });
  });

  it("sets nothing by itself", async () => {
    sources.immich.search.mockResolvedValue({
      assets: [asset("entry-photo", { favorite: true, lat: 38.7, lon: -9.14 })],
      truncated: false,
    });
    await get();
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.coverImageUrl).toBeNull();
  });

  it("sets the cover of an entry-linked photo, and only for an entry on this trip", async () => {
    const link = await prisma.entryPhotoLink.findFirstOrThrow({
      where: { userId, assetId: "entry-photo" },
    });
    const ok = await request(app)
      .post(`/api/v1/trips/${tripId}/cover/entry-photo`)
      .set("Cookie", cookie)
      .send({ linkId: link.id });
    expect(ok.status).toBe(200);
    expect(ok.body.coverImageUrl).toBe(
      `/api/v1/entry-photos/flight/${flightId}/photos/${link.id}/file?size=preview`
    );

    const other = await prisma.trip.create({ data: { userId, name: "Other" } });
    const wrong = await request(app)
      .post(`/api/v1/trips/${other.id}/cover/entry-photo`)
      .set("Cookie", cookie)
      .send({ linkId: link.id });
    expect(wrong.status).toBe(404);
  });

  describe("Das bin ich", () => {
    it("lists a source's people on demand and stores only the chosen id", async () => {
      sources.immich.people.mockResolvedValue([{ id: "person-me", name: "Me" }]);
      const list = await request(app)
        .get("/api/v1/settings/photo-sources/immich/people")
        .set("Cookie", cookie);
      expect(list.body).toEqual({ people: [{ id: "person-me", name: "Me" }], selfPersonId: null });

      const put = await request(app)
        .put("/api/v1/settings/photo-sources/immich/self")
        .set("Cookie", cookie)
        .send({ personId: "person-me" });
      expect(put.status).toBe(200);
      const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
      expect(row.immichSelfPersonId).toBe("person-me");
      expect(row.photoprismSelfPersonId).toBeNull();

      const clear = await request(app)
        .put("/api/v1/settings/photo-sources/immich/self")
        .set("Cookie", cookie)
        .send({ personId: null });
      expect(clear.body).toEqual({ selfPersonId: null });
    });

    it("refuses an id that is not a person of that source", async () => {
      sources.photoprism.people.mockResolvedValue([{ id: "pq1", name: "Me" }]);
      const res = await request(app)
        .put("/api/v1/settings/photo-sources/photoprism/self")
        .set("Cookie", cookie)
        .send({ personId: "someone-else" });
      expect(res.status).toBe(404);
    });

    it("says so when the source is down instead of an empty list", async () => {
      sources.immich.people.mockRejectedValue(new ImmichError("unreachable", "down"));
      const res = await request(app)
        .get("/api/v1/settings/photo-sources/immich/people")
        .set("Cookie", cookie);
      expect(res.status).toBe(502);
      expect(res.body.error).toBe("unreachable");
    });
  });
});

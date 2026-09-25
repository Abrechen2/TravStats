import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { Readable } from "stream";

const searchAssetsByDate =
  jest.fn<(range: { takenAfter: Date; takenBefore: Date }) => Promise<unknown>>();
const fetchAssetStream = jest.fn<(assetId: string, size: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichClient", () => ({
  createImmichClient: () => ({ searchAssetsByDate, fetchAssetStream }),
}));
const getImmichConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichResolver", () => ({
  getImmichConnection: (userId: string) => getImmichConnection(userId),
}));

import fs from "fs";
import path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { getTripPhotoDir } from "../../middleware/upload";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Package 9, item 2: "Fotos aus deiner Reise" on a place visit.
 *
 * What these pin: the day is the visit's day read in the PLACE's zone (a photo
 * at 00:30 Rome time on the day counts, though its UTC day is the one before);
 * only photos within 300 m count; a stranger's photos never appear; a library
 * id is served and linked only when the server's own search returned it near
 * the place; a pick is a link, and picking twice adds nothing.
 */
const NEAR_ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FAR_ASSET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BLIND_ASSET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONNECTION = { baseUrl: "http://immich.test", apiKey: "k", source: "user" };
const TREVI = { lat: 41.9009, lon: 12.4833 };

const libraryAsset = (id: string, lat: number | null, lon: number | null) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2024-05-01T10:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  lat,
  lon,
});

describe("place-visit photo suggestions", () => {
  const stamp = Date.now();
  let cookie: string;
  let strangerCookie: string;
  let visitId: string;
  const ids: Record<string, string> = {};
  const files: string[] = [];

  const tripPhoto = async (tripId: string, takenAt: string, lat: number, lon: number) => {
    const filename = `sugg-${stamp}-${Math.random().toString(36).slice(2)}.jpg`;
    fs.writeFileSync(path.join(getTripPhotoDir(), filename), "trip-bytes");
    files.push(filename);
    return prisma.tripPhoto.create({
      data: {
        tripId,
        filename,
        mimetype: "image/jpeg",
        sizeBytes: 10,
        takenAt: new Date(takenAt),
        lat,
        lon,
      },
    });
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `vps-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `vps-other-${stamp}`, passwordHash },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    const place = await prisma.place.create({ data: { userId: user.id, name: "Trevi", ...TREVI } });
    visitId = (
      await prisma.placeVisit.create({
        data: { userId: user.id, placeId: place.id, visitedAt: new Date("2024-05-01T15:00:00Z") },
      })
    ).id;
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Roma" } });
    const strangerTrip = await prisma.trip.create({ data: { userId: stranger.id, name: "Roma" } });

    ids.noon = (await tripPhoto(trip.id, "2024-05-01T10:00:00Z", 41.901, 12.4834)).id;
    // 00:30 in Rome on the visit's day; its UTC day is the day before.
    ids.earlyLocal = (await tripPhoto(trip.id, "2024-04-30T22:30:00Z", 41.9008, 12.4832)).id;
    ids.far = (await tripPhoto(trip.id, "2024-05-01T11:00:00Z", 41.95, 12.5)).id;
    // 00:30 in Rome the NEXT day; its UTC day is the visit's.
    ids.nextLocal = (await tripPhoto(trip.id, "2024-05-01T22:30:00Z", 41.901, 12.4834)).id;
    ids.strangers = (await tripPhoto(strangerTrip.id, "2024-05-01T10:00:00Z", 41.901, 12.4834)).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `vps-` } } });
    for (const f of files) fs.rmSync(path.join(getTripPhotoDir(), f), { force: true });
  });

  beforeEach(() => {
    clearImmichAssetCache();
    searchAssetsByDate.mockReset();
    fetchAssetStream.mockReset();
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue(CONNECTION);
    searchAssetsByDate.mockResolvedValue({
      assets: [
        libraryAsset(NEAR_ASSET, 41.9011, 12.4835),
        libraryAsset(FAR_ASSET, 41.95, 12.5),
        libraryAsset(BLIND_ASSET, null, null),
      ],
      truncated: false,
    });
  });

  it("suggests that day's photos near the place, from the trips and the library", async () => {
    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.day).toBe("2024-05-01");
    expect(res.body.data.library).toBe("ok");
    const suggested = res.body.data.suggestions.map((s: { kind: string; id: string }) => [
      s.kind,
      s.id,
    ]);
    expect(suggested).toEqual([
      ["trip", ids.earlyLocal],
      ["trip", ids.noon],
      ["library", NEAR_ASSET],
    ]);
    // The library is asked for the Rome day, not the UTC one.
    const range = searchAssetsByDate.mock.calls[0][0];
    expect(range.takenAfter.toISOString()).toBe("2024-04-30T22:00:00.000Z");
    expect(range.takenBefore.toISOString()).toBe("2024-05-01T21:59:59.999Z");
  });

  it("serves a suggested library thumbnail and refuses one that was not suggested", async () => {
    fetchAssetStream.mockResolvedValue({
      stream: Readable.from([Buffer.from("immich-bytes")]),
      contentType: "image/jpeg",
      contentLength: 12,
    });
    const base = `/api/v1/places/visits/${visitId}/photo-suggestions/library`;
    await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", cookie);

    const near = await request(app).get(`${base}/${NEAR_ASSET}/file`).set("Cookie", cookie);
    expect(near.status).toBe(200);
    expect(fetchAssetStream).toHaveBeenCalledWith(NEAR_ASSET, "thumbnail");

    const far = await request(app).get(`${base}/${FAR_ASSET}/file`).set("Cookie", cookie);
    expect(far.status).toBe(404);
    const stranger = await request(app)
      .get(`${base}/${NEAR_ASSET}/file`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);
    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
  });

  it("proves a thumbnail only against a listing already made, never by searching", async () => {
    // A thumbnail request is cheap to repeat; a day search is not, and the
    // connection may be a shared one. Without a listing there is no proof.
    fetchAssetStream.mockResolvedValue({
      stream: Readable.from([Buffer.from("immich-bytes")]),
      contentType: "image/jpeg",
      contentLength: 12,
    });
    const file = `/api/v1/places/visits/${visitId}/photo-suggestions/library/${NEAR_ASSET}/file`;

    const cold = await request(app).get(file).set("Cookie", cookie);
    expect(cold.status).toBe(404);
    expect(searchAssetsByDate).not.toHaveBeenCalled();
    expect(fetchAssetStream).not.toHaveBeenCalled();

    await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", cookie);
    const warm = await request(app).get(file).set("Cookie", cookie);
    expect(warm.status).toBe(200);
    expect(warm.body.toString()).toBe("immich-bytes");
    expect(searchAssetsByDate).toHaveBeenCalledTimes(1);

    const revalidated = await request(app)
      .get(file)
      .set("Cookie", cookie)
      .set("If-None-Match", `"${NEAR_ASSET}-thumbnail"`);
    expect(revalidated.status).toBe(304);
    expect(searchAssetsByDate).toHaveBeenCalledTimes(1);
  });

  it("links only the caller's photos and the proven library ids, once", async () => {
    const link = () =>
      request(app)
        .post(`/api/v1/places/visits/${visitId}/photo-suggestions/link`)
        .set("Cookie", cookie)
        .send({ tripPhotoIds: [ids.noon, ids.strangers], assetIds: [NEAR_ASSET, FAR_ASSET] });

    const first = await link();
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ linked: 2, skipped: 2 });
    const again = await link();
    expect(again.body.data).toEqual({ linked: 0, skipped: 2 });

    const rows = await prisma.placeVisitPhoto.findMany({ where: { placeVisitId: visitId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.filename === null)).toBe(true);
    expect(rows.map((row) => row.tripPhotoId ?? row.immichAssetId).sort()).toEqual(
      [ids.noon, NEAR_ASSET].sort()
    );

    // Linked photos are no longer offered.
    const after = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", cookie);
    expect(after.body.data.suggestions.map((s: { id: string }) => s.id)).toEqual([ids.earlyLocal]);

    // The trip-photo link streams the trip photo's own file.
    const linkedTrip = rows.find((row) => row.tripPhotoId === ids.noon)!;
    const file = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos/${linkedTrip.id}/file`)
      .set("Cookie", cookie)
      .buffer(true);
    expect(file.status).toBe(200);
    expect(file.body.toString()).toBe("trip-bytes");
  });

  it("does not stream a linked trip photo that is not the caller's", async () => {
    // Written directly: the link route would refuse it. The file route must too.
    const row = await prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: visitId,
        filename: null,
        mimetype: "image/jpeg",
        sizeBytes: 0,
        tripPhotoId: ids.strangers,
      },
    });
    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos/${row.id}/file`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
    await prisma.placeVisitPhoto.delete({ where: { id: row.id } });
  });

  it("is a 404 for a stranger's visit and says when there is no library", async () => {
    const stranger = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);

    getImmichConnection.mockResolvedValue(null);
    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", cookie);
    expect(res.body.data.library).toBe("notConfigured");
  });
});

import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const searchAssetsByDate =
  jest.fn<(range: { takenAfter: Date; takenBefore: Date }) => Promise<unknown>>();
jest.mock("../../services/immich/immichClient", () => ({
  createImmichClient: () => ({ searchAssetsByDate, fetchAssetStream: jest.fn() }),
}));
const getImmichConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichResolver", () => ({
  getImmichConnection: (userId: string) => getImmichConnection(userId),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * forgejo#132 item 13: "Nicht diese" on a visit's photo suggestion is kept by
 * the server, per visit, so the suggestion does not come back on the next
 * device or the next opening — it used to live on the phone alone. Pinned: a
 * refused trip photo and library photo leave the list and stay gone, the
 * refusal is the visit's (another visit still gets the photo), a stranger's
 * photo id is skipped rather than stored, and the refusals can be undone.
 */
const NEAR_ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TREVI = { lat: 41.9009, lon: 12.4833 };

describe("refusing a visit photo suggestion", () => {
  const stamp = Date.now();
  let cookie: string;
  let strangerCookie: string;
  let visitId: string;
  let otherVisitId: string;
  let noonId: string;
  let laterId: string;
  let strangersId: string;

  const suggestions = async (id = visitId) =>
    (
      await request(app).get(`/api/v1/places/visits/${id}/photo-suggestions`).set("Cookie", cookie)
    ).body.data.suggestions.map((s: { kind: string; id: string }) => `${s.kind}:${s.id}`);
  const refuse = (body: Record<string, unknown>, c = cookie) =>
    request(app)
      .post(`/api/v1/places/visits/${visitId}/photo-suggestions/refusals`)
      .set("Cookie", c)
      .send(body);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `vpr-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `vpr-other-${stamp}`, passwordHash },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    const place = await prisma.place.create({ data: { userId: user.id, name: "Trevi", ...TREVI } });
    const visit = (at: string) =>
      prisma.placeVisit.create({
        data: { userId: user.id, placeId: place.id, visitedAt: new Date(at) },
      });
    visitId = (await visit("2024-05-01T15:00:00Z")).id;
    otherVisitId = (await visit("2024-05-01T18:00:00Z")).id;
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Roma" } });
    const strangerTrip = await prisma.trip.create({ data: { userId: stranger.id, name: "Roma" } });
    const photo = async (tripId: string, takenAt: string) =>
      (
        await prisma.tripPhoto.create({
          data: {
            tripId,
            filename: `vpr-${stamp}-${takenAt}.jpg`,
            mimetype: "image/jpeg",
            sizeBytes: 10,
            takenAt: new Date(takenAt),
            lat: 41.901,
            lon: 12.4834,
          },
        })
      ).id;
    noonId = await photo(trip.id, "2024-05-01T10:00:00Z");
    laterId = await photo(trip.id, "2024-05-01T12:00:00Z");
    strangersId = await photo(strangerTrip.id, "2024-05-01T10:00:00Z");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `vpr-` } } });
  });

  beforeEach(() => {
    clearImmichAssetCache();
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue({
      baseUrl: "http://immich.test",
      apiKey: "k",
      source: "user",
    });
    searchAssetsByDate.mockReset();
    searchAssetsByDate.mockResolvedValue({
      assets: [
        {
          id: NEAR_ASSET,
          type: "IMAGE",
          fileCreatedAt: "2024-05-01T10:00:00.000Z",
          originalFileName: "n.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 100,
          lat: 41.9011,
          lon: 12.4835,
        },
      ],
      truncated: false,
    });
  });

  it("drops a refused trip photo and library photo from the list, and they stay gone", async () => {
    expect(await suggestions()).toEqual([
      `trip:${noonId}`,
      `trip:${laterId}`,
      `library:${NEAR_ASSET}`,
    ]);

    const res = await refuse({ tripPhotoIds: [noonId], assetIds: [NEAR_ASSET] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { refused: 2, skipped: 0 } });

    expect(await suggestions()).toEqual([`trip:${laterId}`]);
    // A second refusal of the same photo is a no-op, not a second row.
    expect((await refuse({ tripPhotoIds: [noonId] })).body.data).toEqual({
      refused: 0,
      skipped: 0,
    });
    expect(await prisma.visitPhotoRefusal.count({ where: { placeVisitId: visitId } })).toBe(2);
  });

  it("is the visit's refusal: another visit that day is still offered the photo", async () => {
    expect(await suggestions(otherVisitId)).toContain(`trip:${noonId}`);
  });

  it("skips a stranger's photo id instead of storing it, and 404s a stranger's visit", async () => {
    const res = await refuse({ tripPhotoIds: [strangersId] });
    expect(res.body.data).toEqual({ refused: 0, skipped: 1 });
    expect(await prisma.visitPhotoRefusal.count({ where: { suggestionId: strangersId } })).toBe(0);
    expect((await refuse({ tripPhotoIds: [laterId] }, strangerCookie)).status).toBe(404);
    expect((await refuse({ tripPhotoIds: ["not-a-uuid"] })).status).toBe(400);
  });

  it("brings refused suggestions back when the refusals are cleared", async () => {
    const res = await request(app)
      .delete(`/api/v1/places/visits/${visitId}/photo-suggestions/refusals`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { cleared: 2 } });
    expect(await suggestions()).toEqual([
      `trip:${noonId}`,
      `trip:${laterId}`,
      `library:${NEAR_ASSET}`,
    ]);
  });
});

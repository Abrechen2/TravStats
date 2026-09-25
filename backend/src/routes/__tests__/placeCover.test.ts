import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Package 9, item 3: the place page's gallery and lead photograph.
 *
 * The detail used to send the raw photo rows, so every stored visit photo drew
 * as a broken image after a reload (no `url`) — the gallery is built on that
 * response, so it is pinned here. The cover may only be a photo of a visit to
 * THIS place of THIS user.
 */
describe("place gallery and cover", () => {
  const stamp = Date.now();
  let cookie: string;
  let strangerCookie: string;
  let placeId: string;
  let photoId: string;
  let otherPlacePhotoId: string;

  const photoOn = async (userId: string, place: string) => {
    const visit = await prisma.placeVisit.create({ data: { userId, placeId: place } });
    return prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: visit.id,
        filename: `cover-${stamp}.jpg`,
        mimetype: "image/jpeg",
        sizeBytes: 1,
        checksum: "secret-ish",
      },
    });
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `pcov-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `pcov-other-${stamp}`, passwordHash },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    placeId = (await prisma.place.create({ data: { userId: user.id, name: "A", lat: 1, lon: 1 } }))
      .id;
    const other = await prisma.place.create({
      data: { userId: user.id, name: "B", lat: 2, lon: 2 },
    });
    photoId = (await photoOn(user.id, placeId)).id;
    otherPlacePhotoId = (await photoOn(user.id, other.id)).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `pcov-` } } });
  });

  const setCover = (id: string | null, as = cookie) =>
    request(app).put(`/api/v1/places/${placeId}/cover`).set("Cookie", as).send({ photoId: id });

  it("sends each visit photo with its url, and without its file name or checksum", async () => {
    const res = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", cookie);
    const photo = res.body.data.visits[0].photos[0];
    expect(photo.url).toMatch(new RegExp(`/api/v1/places/visits/.+/photos/${photoId}/file$`));
    expect(photo).not.toHaveProperty("filename");
    expect(photo).not.toHaveProperty("checksum");
  });

  it("takes a photo of this place as its cover and returns to the default on null", async () => {
    expect((await setCover(photoId)).body.data).toEqual({ coverPhotoId: photoId });
    const detail = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", cookie);
    expect(detail.body.data.coverPhotoId).toBe(photoId);
    expect((await setCover(null)).body.data).toEqual({ coverPhotoId: null });
  });

  it("refuses a photo of another place and a stranger's request", async () => {
    expect((await setCover(otherPlacePhotoId)).status).toBe(404);
    expect((await setCover(photoId, strangerCookie)).status).toBe(404);
    const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
    expect(place.coverPhotoId).toBeNull();
  });

  it("forgets the cover when the photo is deleted", async () => {
    await setCover(photoId);
    await prisma.placeVisitPhoto.delete({ where: { id: photoId } });
    const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
    expect(place.coverPhotoId).toBeNull();
  });
});

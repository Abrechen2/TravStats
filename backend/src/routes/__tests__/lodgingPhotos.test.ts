import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Photographs of a house.
 *
 * What is pinned here is OWNERSHIP, not the happy path. Every handler resolves
 * the lodging scoped to the caller first and only then uses the photo id
 * together with that lodging — looking a photo up by its own id and checking
 * the owner afterwards is the same query written in the order that leaks
 * existence through the error it returns.
 *
 * A foreign-key relation proves the row EXISTS, never that the caller owns it,
 * so the victim below is a real second account with a real lodging and a real
 * photo rather than an invented id.
 */
describe("lodging photos", () => {
  let owner: { id: string };
  let stranger: { id: string };
  let ownerCookie: string;
  let strangerCookie: string;
  let ownerLodgingId: string;
  let strangerPhotoId: string;
  let strangerLodgingId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    [owner, stranger] = await Promise.all([
      prisma.user.create({
        data: {
          username: `lodging-photos-owner-${stamp}`,
          passwordHash: await hashPassword("test-password"),
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          username: `lodging-photos-stranger-${stamp}`,
          passwordHash: await hashPassword("test-password"),
          isActive: true,
        },
      }),
    ]);
    ownerCookie = `auth_token=${generateToken(owner.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;

    const [a, b] = await Promise.all([
      prisma.lodging.create({ data: { userId: owner.id, name: "Hotel Adlon", type: "hotel" } }),
      prisma.lodging.create({ data: { userId: stranger.id, name: "Le Meurice", type: "hotel" } }),
    ]);
    ownerLodgingId = a.id;
    strangerLodgingId = b.id;

    const photo = await prisma.lodgingPhoto.create({
      data: {
        lodgingId: strangerLodgingId,
        filename: "not-yours.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1234,
      },
    });
    strangerPhotoId = photo.id;
  });

  afterAll(async () => {
    await prisma.user
      .deleteMany({ where: { id: { in: [owner.id, stranger.id] } } })
      .catch(() => {});
  });

  it("lists nothing for a lodging with no photos", async () => {
    const res = await request(app)
      .get(`/api/v1/lodging/${ownerLodgingId}/photos`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("answers 404 for someone else's lodging, not 403", async () => {
    // 403 would confirm the lodging exists. 404 says nothing either way.
    const res = await request(app)
      .get(`/api/v1/lodging/${strangerLodgingId}/photos`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(404);
  });

  it("refuses to serve someone else's photo even with the right photo id", async () => {
    // The photo id is real and the caller is authenticated: only the pairing of
    // photo and OWNED lodging keeps this out.
    const res = await request(app)
      .get(`/api/v1/lodging/${ownerLodgingId}/photos/${strangerPhotoId}/file`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(404);
  });

  it("refuses to delete someone else's photo, and leaves it in place", async () => {
    const res = await request(app)
      .delete(`/api/v1/lodging/${ownerLodgingId}/photos/${strangerPhotoId}`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(404);
    const still = await prisma.lodgingPhoto.findUnique({ where: { id: strangerPhotoId } });
    expect(still).not.toBeNull();
  });

  it("lets the owner rename and reorder their own photo", async () => {
    const mine = await prisma.lodgingPhoto.create({
      data: {
        lodgingId: ownerLodgingId,
        filename: "lobby.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 999,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/lodging/${ownerLodgingId}/photos/${mine.id}`)
      .set("Cookie", ownerCookie)
      .send({ caption: "Lobby am Morgen", sortIdx: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ caption: "Lobby am Morgen", sortIdx: 3 });
    // The URL is built from the pairing, so a client cannot construct one that
    // reaches a photo through a lodging it does not belong to.
    expect(res.body.data.url).toBe(
      `/api/v1/lodging/${ownerLodgingId}/photos/${mine.id}/file`
    );
  });

  it("rejects an upload with no files rather than creating an empty row", async () => {
    const res = await request(app)
      .post(`/api/v1/lodging/${ownerLodgingId}/photos`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(400);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get(`/api/v1/lodging/${ownerLodgingId}/photos`);
    expect(res.status).toBe(401);
  });
});

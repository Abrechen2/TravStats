import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getPlacePhotoDir } from "../../middleware/upload";

const USERS = ["photoplacetest", "photoplaceother"];

/** A real PNG header — the upload filter checks the declared mimetype, and a
 *  believable body keeps this test honest about what it is sending. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

describe("Place visit photos API", () => {
  let authCookie: string;
  let otherCookie: string;
  let userId: string;
  let otherUserId: string;
  let visitId: string;
  let foreignVisitId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.place.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });

    const place = await prisma.place.create({
      data: { userId, name: "Kolosseum", category: "landmark", lat: 41.89, lon: 12.49, visited: true },
    });
    visitId = (
      await prisma.placeVisit.create({
        data: { placeId: place.id, userId, visitedAt: new Date("2024-06-12") },
      })
    ).id;

    const foreignPlace = await prisma.place.create({
      data: { userId: otherUserId, name: "Fremd", category: "other", lat: 1, lon: 1 },
    });
    foreignVisitId = (
      await prisma.placeVisit.create({ data: { placeId: foreignPlace.id, userId: otherUserId } })
    ).id;
  });

  const upload = (id: string, cookie = authCookie, filename = "proof.png") =>
    request(app)
      .post(`/api/v1/places/visits/${id}/photos`)
      .set("Cookie", cookie)
      .attach("photos", PNG, filename);

  it("uploads a photo and answers with a URL the client can use verbatim", async () => {
    const res = await upload(visitId);
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].url).toBe(
      `/api/v1/places/visits/${visitId}/photos/${res.body.data[0].id}/file`
    );

    const stored = await prisma.placeVisitPhoto.findMany({ where: { placeVisitId: visitId } });
    expect(stored).toHaveLength(1);
    expect(fs.existsSync(path.join(getPlacePhotoDir(), stored[0].filename))).toBe(true);
  });

  it("serves the bytes back with a PRIVATE cache header", async () => {
    const uploaded = await upload(visitId);
    const photoId = uploaded.body.data[0].id;

    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos/${photoId}/file`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    // Overrides the global no-store on /api, and `private` is the whole point:
    // a shared cache must never hold one user's photo.
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).not.toContain("public");
  });

  it("refuses to upload against someone else's visit", async () => {
    const res = await upload(foreignVisitId);
    expect(res.status).toBe(404);
    expect(await prisma.placeVisitPhoto.count({ where: { placeVisitId: foreignVisitId } })).toBe(0);
  });

  it("leaves no orphaned bytes behind when the upload is rejected", async () => {
    const before = fs.readdirSync(getPlacePhotoDir()).length;
    await upload(foreignVisitId);
    // Multer has already written the file by the time the handler runs, so a
    // rejected upload must clean up or the directory grows on every attempt.
    expect(fs.readdirSync(getPlacePhotoDir()).length).toBe(before);
  });

  it("hides another user's photo behind the same 404 as a missing one", async () => {
    const uploaded = await upload(visitId);
    const photoId = uploaded.body.data[0].id;

    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos/${photoId}/file`)
      .set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("rejects a request with no file at all", async () => {
    const res = await request(app)
      .post(`/api/v1/places/visits/${visitId}/photos`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("numbers photos in upload order", async () => {
    await upload(visitId, authCookie, "one.png");
    await upload(visitId, authCookie, "two.png");

    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos`)
      .set("Cookie", authCookie);
    expect(res.body.data.map((p: { sortIdx: number }) => p.sortIdx)).toEqual([0, 1]);
  });

  it("updates a caption", async () => {
    const uploaded = await upload(visitId);
    const photoId = uploaded.body.data[0].id;

    const res = await request(app)
      .patch(`/api/v1/places/visits/${visitId}/photos/${photoId}`)
      .set("Cookie", authCookie)
      .send({ caption: "Südtor, 10 Uhr" });

    expect(res.status).toBe(200);
    expect(res.body.data.caption).toBe("Südtor, 10 Uhr");
  });

  it("deletes the row AND the file", async () => {
    const uploaded = await upload(visitId);
    const photoId = uploaded.body.data[0].id;
    const stored = await prisma.placeVisitPhoto.findUnique({ where: { id: photoId } });

    const res = await request(app)
      .delete(`/api/v1/places/visits/${visitId}/photos/${photoId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(204);
    expect(await prisma.placeVisitPhoto.findUnique({ where: { id: photoId } })).toBeNull();
    expect(fs.existsSync(path.join(getPlacePhotoDir(), stored!.filename))).toBe(false);
  });

  it("takes its photos with the visit when the visit goes", async () => {
    await upload(visitId);
    await prisma.placeVisit.delete({ where: { id: visitId } });
    // The cascade is on the relation; without it a deleted visit would leave
    // rows nothing can reach and nothing will ever clean up.
    expect(await prisma.placeVisitPhoto.count({ where: { placeVisitId: visitId } })).toBe(0);
  });

  it("carries the photos on the place DETAIL response", async () => {
    const uploaded = await upload(visitId);
    const visit = await prisma.placeVisit.findUnique({ where: { id: visitId } });

    const res = await request(app)
      .get(`/api/v1/places/${visit!.placeId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.visits[0].photos).toHaveLength(1);
    expect(res.body.data.visits[0].photos[0].id).toBe(uploaded.body.data[0].id);
  });

  it("does NOT carry them on the list response", async () => {
    await upload(visitId);
    const res = await request(app).get("/api/v1/places").set("Cookie", authCookie);
    // A gallery per row is a page of joins nobody asked for.
    expect(res.body.data[0].visits[0].photos).toBeUndefined();
  });
});

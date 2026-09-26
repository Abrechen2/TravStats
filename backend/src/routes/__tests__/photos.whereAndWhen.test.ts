import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#132 item 11: a photo says where and when it was taken wherever that
 * is stored, so the viewer can offer "Auf Karte" and a place gallery can be
 * grouped by the day the picture was taken rather than the visit's date.
 * Unknown is null — a lodging photo stores neither, and says so — never a
 * made-up coordinate or the upload time passed off as the capture time.
 */
describe("photo DTOs carry where and when", () => {
  const stamp = Date.now();
  let cookie: string;
  let tripId: string;
  let placedId: string;
  let bareId: string;
  let visitId: string;
  let lodgingId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `photo-ww-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    tripId = (await prisma.trip.create({ data: { userId: user.id, name: "Rom" } })).id;
    placedId = (
      await prisma.tripPhoto.create({
        data: {
          tripId,
          filename: "a.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 10,
          lat: 41.9022,
          lon: 12.4539,
          takenAt: new Date("2025-04-02T09:15:00Z"),
        },
      })
    ).id;
    bareId = (
      await prisma.tripPhoto.create({
        data: { tripId, filename: "b.jpg", mimetype: "image/jpeg", sizeBytes: 10, sortIdx: 1 },
      })
    ).id;

    const place = await prisma.place.create({
      data: {
        userId: user.id,
        name: "Petersdom",
        category: "landmark",
        lat: 41.9022,
        lon: 12.4539,
      },
    });
    visitId = (
      await prisma.placeVisit.create({
        data: { userId: user.id, placeId: place.id, tripId, visitedAt: new Date("2025-04-02") },
      })
    ).id;
    // A picked trip photo (a link) and an upload with only a stated capture time.
    await prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: visitId,
        mimetype: "image/jpeg",
        sizeBytes: 10,
        tripPhotoId: placedId,
        sortIdx: 0,
      },
    });
    await prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: visitId,
        filename: "c.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 10,
        takenAt: new Date("2025-04-02T16:00:00Z"),
        sortIdx: 1,
      },
    });

    lodgingId = (await prisma.lodging.create({ data: { userId: user.id, name: "Hotel Roma" } })).id;
    await prisma.lodgingPhoto.create({
      data: { lodgingId, filename: "d.jpg", mimetype: "image/jpeg", sizeBytes: 10 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: `photo-ww-${stamp}` } });
  });

  it("a trip photo carries its stored position and capture time, nulls where there are none", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}/photos`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.photos.map((p: { id: string }) => [p.id, p]));
    expect(byId.get(placedId)).toMatchObject({
      lat: 41.9022,
      lon: 12.4539,
      takenAt: "2025-04-02T09:15:00.000Z",
    });
    expect(byId.get(bareId)).toMatchObject({ lat: null, lon: null, takenAt: null });

    const detail = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    const photo = detail.body.trip.photos.find((p: { id: string }) => p.id === placedId);
    expect(photo).toMatchObject({ lat: 41.9022, lon: 12.4539 });
  });

  it("a visit photo carries its capture time, and a picked trip photo's position and time", async () => {
    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photos`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const [link, upload] = res.body.data;
    expect(link).toMatchObject({
      lat: 41.9022,
      lon: 12.4539,
      takenAt: "2025-04-02T09:15:00.000Z",
    });
    expect(upload).toMatchObject({ lat: null, lon: null, takenAt: "2025-04-02T16:00:00.000Z" });
  });

  it("the place detail's visit photos carry the same", async () => {
    const visit = await prisma.placeVisit.findUniqueOrThrow({ where: { id: visitId } });
    const res = await request(app).get(`/api/v1/places/${visit.placeId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const photos = res.body.data.visits[0].photos;
    expect(photos[0]).toMatchObject({ lat: 41.9022, takenAt: "2025-04-02T09:15:00.000Z" });
  });

  it("a lodging photo says it stores neither, as null", async () => {
    const res = await request(app).get(`/api/v1/lodging/${lodgingId}/photos`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ lat: null, lon: null, takenAt: null });
    expect(Object.keys(res.body.data[0])).toEqual(
      expect.arrayContaining(["lat", "lon", "takenAt"])
    );
  });
});

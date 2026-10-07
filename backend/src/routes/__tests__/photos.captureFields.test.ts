import fs from "fs";
import path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getLodgingPhotoDir, getPlacePhotoDir, getTripPhotoDir } from "../../middleware/upload";

/**
 * companion#59, server half: a photo upload may say when and where the one
 * picture it carries was taken, for a file whose EXIF no longer does. The
 * file is believed first; the fields fill only what it did not say; an
 * offset-less time or fields beside several files are refused before any
 * row or file survives.
 */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
/** EXIF: 2024-05-17 14:23:45 with no offset, placed by its GPS (Paris) — 12:23:45Z. */
const JPEG_WITH_EXIF = fs.readFileSync(
  path.join(__dirname, "../../__tests__/fixtures/photos/synthetic-exif-no-offset.jpg")
);
const EXIF_TAKEN_AT = "2024-05-17T12:23:45.000Z";

const FIELDS = { takenAt: "2025-04-02T09:15:00+02:00", lat: "41.9022", lon: "12.4539" };

describe("photo uploads carrying capture fields", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;
  let visitId: string;
  let lodgingId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `capture-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Rom" } })).id;
    const place = await prisma.place.create({
      data: { userId, name: "Petersdom", category: "landmark", lat: 41.9022, lon: 12.4539 },
    });
    visitId = (
      await prisma.placeVisit.create({
        data: { userId, placeId: place.id, visitedAt: new Date("2025-04-02") },
      })
    ).id;
    lodgingId = (
      await prisma.lodging.create({ data: { userId, name: "Hotel de Russie", type: "hotel" } })
    ).id;
  });

  afterAll(async () => {
    const remove = (dir: string, filename: string | null): void => {
      if (!filename) return;
      const p = path.join(dir, path.basename(filename));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    };
    (await prisma.tripPhoto.findMany({ where: { tripId } })).forEach((p) =>
      remove(getTripPhotoDir(), p.filename)
    );
    (await prisma.placeVisitPhoto.findMany({ where: { placeVisitId: visitId } })).forEach((p) =>
      remove(getPlacePhotoDir(), p.filename)
    );
    (await prisma.lodgingPhoto.findMany({ where: { lodgingId } })).forEach((p) =>
      remove(getLodgingPhotoDir(), p.filename)
    );
    await prisma.user.delete({ where: { id: userId } });
  });

  const listDir = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

  describe("POST /trips/:id/photos", () => {
    const upload = () => request(app).post(`/api/v1/trips/${tripId}/photos`).set("Cookie", cookie);

    it("takes the fields when the file's EXIF yields nothing", async () => {
      const res = await upload()
        .field("takenAt", FIELDS.takenAt)
        .field("lat", FIELDS.lat)
        .field("lon", FIELDS.lon)
        .attach("photos", PNG, { filename: "export.png", contentType: "image/png" });

      expect(res.status).toBe(201);
      expect(res.body.photos[0]).toMatchObject({
        takenAt: "2025-04-02T07:15:00.000Z",
        lat: 41.9022,
        lon: 12.4539,
      });
    });

    it("lets the file's EXIF win over the fields", async () => {
      const res = await upload()
        .field("takenAt", FIELDS.takenAt)
        .field("lat", FIELDS.lat)
        .field("lon", FIELDS.lon)
        .attach("photos", JPEG_WITH_EXIF, { filename: "IMG_1.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      expect(res.body.photos[0].takenAt).toBe(EXIF_TAKEN_AT);
      expect(res.body.photos[0].lat).toBeCloseTo(48.858222, 4);
      expect(res.body.photos[0].lon).toBeCloseTo(2.2945, 4);
    });

    it("refuses an offset-less takenAt, and keeps neither row nor file", async () => {
      const before = await prisma.tripPhoto.count({ where: { tripId } });
      const files = listDir(getTripPhotoDir()).length;
      const res = await upload()
        .field("takenAt", "2025-04-02T09:15:00")
        .attach("photos", PNG, { filename: "export.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/offset/i);
      expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(before);
      expect(listDir(getTripPhotoDir()).length).toBe(files);
    });

    it("refuses the fields beside several files", async () => {
      const before = await prisma.tripPhoto.count({ where: { tripId } });
      const res = await upload()
        .field("lat", FIELDS.lat)
        .field("lon", FIELDS.lon)
        .attach("photos", PNG, { filename: "a.png", contentType: "image/png" })
        .attach("photos", PNG, { filename: "b.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/single file/i);
      expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(before);
    });

    it("refuses a latitude off the globe", async () => {
      const res = await upload()
        .field("lat", "91")
        .field("lon", "0")
        .attach("photos", PNG, { filename: "a.png", contentType: "image/png" });
      expect(res.status).toBe(400);
    });

    it("stores half a position as no position", async () => {
      const res = await upload()
        .field("lat", FIELDS.lat)
        .attach("photos", PNG, { filename: "half.png", contentType: "image/png" });
      expect(res.status).toBe(201);
      expect(res.body.photos[0]).toMatchObject({ lat: null, lon: null });
    });
  });

  describe("POST /places/visits/:id/photos", () => {
    const upload = () =>
      request(app).post(`/api/v1/places/visits/${visitId}/photos`).set("Cookie", cookie);

    it("takes takenAt from the field when the file's EXIF has none", async () => {
      const res = await upload()
        .field("takenAt", FIELDS.takenAt)
        .attach("photos", PNG, { filename: "export.png", contentType: "image/png" });
      expect(res.status).toBe(201);
      expect(res.body.data[0].takenAt).toBe("2025-04-02T07:15:00.000Z");
    });

    it("lets the file's EXIF win", async () => {
      const res = await upload()
        .field("takenAt", FIELDS.takenAt)
        .attach("photos", JPEG_WITH_EXIF, { filename: "IMG_1.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(201);
      expect(res.body.data[0].takenAt).toBe(EXIF_TAKEN_AT);
    });

    it("refuses an offset-less takenAt and fields beside several files", async () => {
      const bare = await upload()
        .field("takenAt", "2025-04-02T09:15:00")
        .attach("photos", PNG, { filename: "export.png", contentType: "image/png" });
      expect(bare.status).toBe(400);

      const many = await upload()
        .field("takenAt", FIELDS.takenAt)
        .attach("photos", PNG, { filename: "a.png", contentType: "image/png" })
        .attach("photos", PNG, { filename: "b.png", contentType: "image/png" });
      expect(many.status).toBe(400);
    });
  });

  describe("POST /lodging/:id/photos", () => {
    const upload = () =>
      request(app).post(`/api/v1/lodging/${lodgingId}/photos`).set("Cookie", cookie);

    it("validates the fields on the same terms, and stores none of them", async () => {
      const bare = await upload()
        .field("takenAt", "2025-04-02T09:15:00")
        .attach("photos", PNG, { filename: "export.png", contentType: "image/png" });
      expect(bare.status).toBe(400);

      const many = await upload()
        .field("lat", FIELDS.lat)
        .field("lon", FIELDS.lon)
        .attach("photos", PNG, { filename: "a.png", contentType: "image/png" })
        .attach("photos", PNG, { filename: "b.png", contentType: "image/png" });
      expect(many.status).toBe(400);
      expect(await prisma.lodgingPhoto.count({ where: { lodgingId } })).toBe(0);

      const ok = await upload()
        .field("takenAt", FIELDS.takenAt)
        .field("lat", FIELDS.lat)
        .field("lon", FIELDS.lon)
        .attach("photos", PNG, { filename: "export.png", contentType: "image/png" });
      expect(ok.status).toBe(201);
      // No column for when or where — the DTO says so rather than guessing.
      expect(ok.body.data[0]).toMatchObject({ takenAt: null, lat: null, lon: null });
    });
  });
});

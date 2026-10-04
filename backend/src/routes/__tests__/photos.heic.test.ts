import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getLodgingPhotoDir, getPlacePhotoDir, getTripPhotoDir } from "../../middleware/upload";
import { displayRenditionName } from "../../services/photos/displayRendition";
import { shutdownHeicConverter } from "../../services/photos/heicConverter";

/**
 * forgejo#192: an iPhone camera photo is a HEIC, and every photo upload route
 * answered it with 400 — the Companion could only say "the photo did not
 * arrive". Now the original is KEPT byte-for-byte (an Immich link later
 * matches it by checksum), the browser gets a JPEG it can draw, the EXIF in
 * the HEIC container fills `takenAt`/`lat`/`lon`, and a HEIC that cannot be
 * decoded is refused with a code instead of stored as a tile nobody can see.
 *
 * The fixture is a real HEVC-coded HEIC, synthetic — see
 * `__tests__/fixtures/photos/make-photo-fixtures.py`.
 */
const HEIC = fs.readFileSync(
  path.join(__dirname, "../../__tests__/fixtures/photos/synthetic-exif.heic")
);
const BROKEN_HEIC = HEIC.subarray(0, 400);
const JPEG_SOI = Buffer.from([0xff, 0xd8]);

const sha1 = (bytes: Buffer): string => createHash("sha1").update(bytes).digest("base64");
const listDir = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

describe("HEIC/HEIF photo uploads", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;
  let visitId: string;
  let lodgingId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `heic-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Paris" } })).id;
    const place = await prisma.place.create({
      data: { userId, name: "Eiffelturm", category: "landmark", lat: 48.8582, lon: 2.2945 },
    });
    visitId = (
      await prisma.placeVisit.create({
        data: { userId, placeId: place.id, visitedAt: new Date("2024-05-17") },
      })
    ).id;
    lodgingId = (
      await prisma.lodging.create({ data: { userId, name: "Hotel Lutetia", type: "hotel" } })
    ).id;
  });

  afterAll(async () => {
    // Through the routes' own delete helpers would be nicer; the rows are
    // gone with the user, so the files are removed by name here.
    const trips = await prisma.tripPhoto.findMany({ where: { trip: { userId } } });
    const visits = await prisma.placeVisitPhoto.findMany({ where: { visit: { userId } } });
    const lodgings = await prisma.lodgingPhoto.findMany({ where: { lodging: { userId } } });
    const remove = (dir: string, filename: string | null): void => {
      if (!filename) return;
      for (const name of [filename, displayRenditionName(filename)]) {
        const p = path.join(dir, path.basename(name));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    };
    trips.forEach((p) => remove(getTripPhotoDir(), p.filename));
    visits.forEach((p) => remove(getPlacePhotoDir(), p.filename));
    lodgings.forEach((p) => remove(getLodgingPhotoDir(), p.filename));
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    shutdownHeicConverter();
  });

  describe("trip photos", () => {
    let photoId: string;
    let filename: string;

    it("accepts a HEIC, keeps the original bytes and reads its EXIF", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/photos`)
        .set("Cookie", cookie)
        .attach("photos", HEIC, { filename: "IMG_0001.HEIC", contentType: "image/heic" });

      expect(res.status).toBe(201);
      const [dto] = res.body.photos;
      expect(dto.mimetype).toBe("image/heic");
      expect(dto.takenAt).toBe("2024-05-17T12:23:45.000Z");
      expect(dto.lat).toBeCloseTo(48.858222, 5);
      expect(dto.lon).toBeCloseTo(2.2945, 5);

      const row = await prisma.tripPhoto.findUniqueOrThrow({ where: { id: dto.id } });
      photoId = row.id;
      filename = row.filename;
      // The original, untouched: same bytes, same checksum Immich would report.
      const stored = fs.readFileSync(path.join(getTripPhotoDir(), row.filename));
      expect(sha1(stored)).toBe(sha1(HEIC));
      expect(fs.existsSync(path.join(getTripPhotoDir(), displayRenditionName(row.filename)))).toBe(
        true
      );
    });

    it("serves a JPEG on /file and the original on ?variant=original", async () => {
      const display = await request(app)
        .get(`/api/v1/trips/${tripId}/photos/${photoId}/file`)
        .set("Cookie", cookie)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(display.status).toBe(200);
      expect(display.headers["content-type"]).toMatch(/^image\/jpeg/);
      expect((display.body as Buffer).subarray(0, 2)).toEqual(JPEG_SOI);

      const original = await request(app)
        .get(`/api/v1/trips/${tripId}/photos/${photoId}/file?variant=original`)
        .set("Cookie", cookie)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(original.status).toBe(200);
      expect(original.headers["content-type"]).toMatch(/^image\/heic/);
      expect(sha1(original.body as Buffer)).toBe(sha1(HEIC));
    });

    it("rebuilds a missing JPEG copy on read instead of answering 404", async () => {
      fs.unlinkSync(path.join(getTripPhotoDir(), displayRenditionName(filename)));

      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/photos/${photoId}/file`)
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^image\/jpeg/);
      expect(fs.existsSync(path.join(getTripPhotoDir(), displayRenditionName(filename)))).toBe(
        true
      );
    });

    it("refuses an unknown variant with 400", async () => {
      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/photos/${photoId}/file?variant=thumbnail`)
        .set("Cookie", cookie);

      expect(res.status).toBe(400);
    });

    it("deletes the JPEG copy with the photo", async () => {
      const res = await request(app)
        .delete(`/api/v1/trips/${tripId}/photos/${photoId}`)
        .set("Cookie", cookie);

      expect(res.status).toBe(204);
      expect(fs.existsSync(path.join(getTripPhotoDir(), filename))).toBe(false);
      expect(fs.existsSync(path.join(getTripPhotoDir(), displayRenditionName(filename)))).toBe(
        false
      );
    });

    it("refuses an undecodable HEIC with PHOTO_UNREADABLE and keeps no row and no byte", async () => {
      const before = listDir(getTripPhotoDir());
      const rowsBefore = await prisma.tripPhoto.count({ where: { tripId } });

      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/photos`)
        .set("Cookie", cookie)
        // A good HEIC first, so its JPEG copy exists when the second one fails.
        .attach("photos", HEIC, { filename: "good.heic", contentType: "image/heic" })
        .attach("photos", BROKEN_HEIC, { filename: "broken.heic", contentType: "image/heic" });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("PHOTO_UNREADABLE");
      expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(rowsBefore);
      expect(listDir(getTripPhotoDir())).toEqual(before);
    });

    it("accepts a HEIC as the trip cover and serves it as JPEG", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/cover`)
        .set("Cookie", cookie)
        .attach("cover", HEIC, { filename: "cover.heif", contentType: "image/heif" });

      expect(res.status).toBe(201);
      const file = await request(app).get(res.body.coverUrl).set("Cookie", cookie);
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toMatch(/^image\/jpeg/);
    });
  });

  it("place-visit photos: keeps the original (checksum of the uploaded bytes) and serves JPEG", async () => {
    const res = await request(app)
      .post(`/api/v1/places/visits/${visitId}/photos`)
      .set("Cookie", cookie)
      .attach("photos", HEIC, { filename: "IMG_0002.HEIC", contentType: "image/heic" });

    expect(res.status).toBe(201);
    const [dto] = res.body.data;
    expect(dto.takenAt).toBe("2024-05-17T12:23:45.000Z");
    const row = await prisma.placeVisitPhoto.findUniqueOrThrow({ where: { id: dto.id } });
    // The checksum an Immich link matches against is the ORIGINAL's.
    expect(row.checksum).toBe(sha1(HEIC));
    expect(row.mimetype).toBe("image/heic");

    const file = await request(app).get(dto.url).set("Cookie", cookie);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/^image\/jpeg/);
  });

  it("lodging photos: accepts a HEIC and serves JPEG", async () => {
    const res = await request(app)
      .post(`/api/v1/lodging/${lodgingId}/photos`)
      .set("Cookie", cookie)
      .attach("photos", HEIC, { filename: "lobby.heic", contentType: "image/heic" });

    expect(res.status).toBe(201);
    const [dto] = res.body.data;
    const file = await request(app).get(dto.url).set("Cookie", cookie);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/^image\/jpeg/);

    const original = await request(app).get(`${dto.url}?variant=original`).set("Cookie", cookie);
    expect(original.headers["content-type"]).toMatch(/^image\/heic/);
  });
});

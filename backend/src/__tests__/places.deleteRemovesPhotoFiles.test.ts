/**
 * AUD-073. Deleting a place or a visit left every photo it owned on disk.
 *
 * The photo ROWS cascade at the database level, and nothing reached their
 * BYTES — so the files stayed for ever, and invisibly, because the row that
 * named them was gone. Deleting a single photo directly has always cleaned up
 * after itself (`routes/places/visitPhotos.ts`); the two parent deletes did
 * not.
 *
 * Asserted against the real upload directory, because the bug is precisely
 * that the filesystem and the database disagreed — a mock of one of them could
 * not see it.
 */
import fs from "fs";
import path from "path";
import request from "supertest";

import app from "../index";
import { prisma } from "../db";
import { getPlacePhotoDir } from "../middleware/upload";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "placedeletephotofiles";

/** A real file on disk, with a photo row pointing at it. */
async function attachPhoto(placeVisitId: string, label: string): Promise<string> {
  const filename = `aud073-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const dir = getPlacePhotoDir();
  fs.mkdirSync(dir, { recursive: true });
  // A one-pixel PNG header is enough: nothing here reads the bytes back.
  fs.writeFileSync(path.join(dir, filename), Buffer.from("89504e470d0a1a0a", "hex"));

  await prisma.placeVisitPhoto.create({
    data: { placeVisitId, filename, mimetype: "image/png", sizeBytes: 8 },
  });
  return filename;
}

const onDisk = (filename: string): boolean =>
  fs.existsSync(path.join(getPlacePhotoDir(), filename));

describe("deleting a place or a visit takes its photo files with it", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  async function makePlaceWithVisit(): Promise<{ placeId: string; visitId: string }> {
    const place = await prisma.place.create({
      data: { userId, name: "Fotohaus", lat: 52.52, lon: 13.405, visited: true },
    });
    const visit = await prisma.placeVisit.create({
      data: { placeId: place.id, userId, visitedAt: new Date("2024-05-01T00:00:00Z") },
    });
    return { placeId: place.id, visitId: visit.id };
  }

  it("removes the files when the VISIT is deleted", async () => {
    const { visitId } = await makePlaceWithVisit();
    const a = await attachPhoto(visitId, "visit-a");
    const b = await attachPhoto(visitId, "visit-b");
    expect(onDisk(a)).toBe(true);

    const res = await request(app)
      .delete(`/api/v1/places/visits/${visitId}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(await prisma.placeVisitPhoto.count({ where: { placeVisitId: visitId } })).toBe(0);
    expect(onDisk(a)).toBe(false);
    expect(onDisk(b)).toBe(false);
  });

  it("removes the files of every visit when the PLACE is deleted", async () => {
    const { placeId, visitId } = await makePlaceWithVisit();
    const second = await prisma.placeVisit.create({
      data: { placeId, userId, visitedAt: new Date("2024-06-01T00:00:00Z") },
    });
    const a = await attachPhoto(visitId, "place-a");
    const b = await attachPhoto(second.id, "place-b");

    const res = await request(app).delete(`/api/v1/places/${placeId}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(onDisk(a)).toBe(false);
    expect(onDisk(b)).toBe(false);
  });

  it("leaves another user's photo alone", async () => {
    // The control: the cleanup must follow ownership, not just filenames.
    const other = await prisma.user.create({
      data: { username: `${USERNAME}-other`, passwordHash: await hashPassword("password123") },
    });
    try {
      const place = await prisma.place.create({
        data: { userId: other.id, name: "Fremdhaus", lat: 1, lon: 1, visited: true },
      });
      const visit = await prisma.placeVisit.create({
        data: { placeId: place.id, userId: other.id, visitedAt: new Date("2024-05-01T00:00:00Z") },
      });
      const theirs = await attachPhoto(visit.id, "other");

      const res = await request(app).delete(`/api/v1/places/${place.id}`).set("Cookie", cookie);

      expect(res.status).toBe(404);
      expect(onDisk(theirs)).toBe(true);
    } finally {
      await prisma.place.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });
});

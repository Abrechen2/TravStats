import * as fs from "fs";
import * as path from "path";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getLodgingPhotoDir } from "../../middleware/upload";

/**
 * Deleting a hotel takes its pictures with it.
 *
 * Deleting a single photo removed the row and then the file. Deleting the
 * HOTEL removed the rows by cascade and left every file in
 * `uploads/lodging-photos` — still on disk, still inside every file backup,
 * with nothing left that could name them again (audit finding AUD-042).
 *
 * The assertion is on the FILE, not on the row: the rows always went, which is
 * exactly why nobody noticed.
 */
const USERNAME = `lodging-photo-file-${Date.now()}`;

// The smallest thing sharp will accept as an image: a real 1x1 PNG.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("lodging photo files", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("removes the uploaded file when the hotel is deleted", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Photo Hotel", type: "hotel" },
    });

    const upload = await request(app)
      .post(`/api/v1/lodging/${lodging.id}/photos`)
      .set("Cookie", cookie)
      .attach("photos", PNG_1x1, { filename: "room.png", contentType: "image/png" });
    expect(upload.status).toBe(201);

    const photo = await prisma.lodgingPhoto.findFirstOrThrow({
      where: { lodgingId: lodging.id },
    });
    const filePath = path.join(getLodgingPhotoDir(), path.basename(photo.filename));
    // The file has to be there first, or the assertion below proves nothing.
    expect(fs.existsSync(filePath)).toBe(true);

    const del = await request(app)
      .delete(`/api/v1/lodging/${lodging.id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);

    expect(await prisma.lodgingPhoto.findUnique({ where: { id: photo.id } })).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

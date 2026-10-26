import fs from "fs";
import path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";

/**
 * A trip photo sent with the Companion's outbox key (audit 2026-10-23): the
 * resend after a lost answer gets the photo the first send made, and the
 * bytes of the repeat are not kept; the same key with another photo is
 * refused.
 */
const png = (fill: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, fill),
  ]);

describe("POST /trips/:id/photos with clientRef", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `photoref-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Bergen" } })).id;
  });

  afterAll(async () => {
    for (const p of await prisma.tripPhoto.findMany({ where: { tripId } })) {
      const file = path.join(getTripPhotoDir(), path.basename(p.filename));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    await prisma.clientWriteRef.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const send = (ref: string, bytes: Buffer, files = 1) => {
    const req = request(app)
      .post(`/api/v1/trips/${tripId}/photos`)
      .set("Cookie", cookie)
      .field("clientRef", ref);
    for (let i = 0; i < files; i += 1) req.attach("photos", bytes, `cockpit-${i}.png`);
    return req;
  };
  const files = () => (fs.existsSync(getTripPhotoDir()) ? fs.readdirSync(getTripPhotoDir()) : []);

  it("answers a resend with the photo the first send made, and keeps no second file", async () => {
    const first = await send("cockpit-1", png(1)).expect(201);
    const before = files().length;
    const again = await send("cockpit-1", png(1)).expect(200);

    expect(again.body.photos[0].id).toBe(first.body.photos[0].id);
    expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(1);
    expect(files().length).toBe(before);
  });

  it("refuses the same key with another photo, and one key for several files", async () => {
    const reused = await send("cockpit-1", png(2)).expect(409);
    expect(reused.body.code).toBe("CLIENT_REF_REUSED");
    await send("cockpit-2", png(3), 2).expect(400);
    expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(1);
  });
});

import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getLoginBackgroundDir } from "../../middleware/upload";

/**
 * The sign-in page's backgrounds (Alex, 2026-09-21).
 *
 * What these pin is the asymmetry the feature rests on: READING is public,
 * because the page that reads it is what a visitor meets before a session
 * exists, and WRITING is admin-only, because putting an image here publishes
 * it to everyone who can reach the instance. Get that pair backwards in
 * either direction and the feature is either broken or a leak.
 */

/** A one-pixel PNG — real magic numbers, which is what the upload checks. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("login backgrounds", () => {
  let adminCookie: string;
  let userCookie: string;
  let adminId: string;
  let userId: string;
  const written: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["lbgadmin", "lbguser"] } } });
    const admin = await prisma.user.create({
      data: {
        username: "lbgadmin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    const user = await prisma.user.create({
      data: { username: "lbguser", passwordHash: await hashPassword("password123") },
    });
    adminId = admin.id;
    userId = user.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    for (const name of written) {
      const p = path.join(getLoginBackgroundDir(), path.basename(name));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("lists without a session — the page asks before anyone has signed in", async () => {
    const res = await request(app).get("/api/v1/login-backgrounds");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.backgrounds)).toBe(true);
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
  });

  it("refuses an upload from a signed-in NON-admin", async () => {
    const res = await request(app)
      .post("/api/v1/login-backgrounds")
      .set("Cookie", userCookie)
      .attach("backgrounds", PNG_1PX, "holiday.png");
    expect(res.status).toBe(403);
  });

  it("refuses an upload with no session at all", async () => {
    const res = await request(app)
      .post("/api/v1/login-backgrounds")
      .attach("backgrounds", PNG_1PX, "holiday.png");
    expect(res.status).toBe(401);
  });

  it("accepts an admin upload, then serves and deletes it", async () => {
    const upload = await request(app)
      .post("/api/v1/login-backgrounds")
      .set("Cookie", adminCookie)
      .attach("backgrounds", PNG_1PX, "holiday.png");
    expect(upload.status).toBe(201);
    expect(upload.body.accepted).toHaveLength(1);
    expect(upload.body.rejected).toEqual([]);

    const name = upload.body.accepted[0] as string;
    written.push(name);
    expect(name).toMatch(/^\d+-[0-9a-f]+-holiday\.png$/);

    // Served to anyone — no cookie.
    const served = await request(app).get(`/api/v1/login-backgrounds/${name}`);
    expect(served.status).toBe(200);
    expect(served.headers["cache-control"]).toBe("private, max-age=3600");

    const listed = await request(app).get("/api/v1/login-backgrounds");
    expect(listed.body.backgrounds).toContain(name);

    const removed = await request(app)
      .delete(`/api/v1/login-backgrounds/${name}`)
      .set("Cookie", adminCookie);
    expect(removed.status).toBe(200);
    expect(removed.body.backgrounds).not.toContain(name);
  });

  it("deletes the bytes of a file that is not an image, and says which", async () => {
    // A renamed text file: the extension and the browser's mimetype both say
    // PNG, and only the magic numbers disagree.
    const before = (await request(app).get("/api/v1/login-backgrounds")).body.backgrounds.length;
    const res = await request(app)
      .post("/api/v1/login-backgrounds")
      .set("Cookie", adminCookie)
      .attach("backgrounds", Buffer.from("this is not a picture"), {
        filename: "notreally.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
    const after = (await request(app).get("/api/v1/login-backgrounds")).body.backgrounds.length;
    expect(after).toBe(before);
  });

  it("never builds a path out of a name it did not generate", async () => {
    const res = await request(app).get("/api/v1/login-backgrounds/..%2F..%2Fpackage.json");
    expect(res.status).toBe(404);
  });

  it("refuses a delete from a non-admin", async () => {
    const res = await request(app)
      .delete("/api/v1/login-backgrounds/whatever.png")
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });
});

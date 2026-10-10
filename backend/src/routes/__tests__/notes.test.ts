import fs from "fs";
import path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { noteCreationLimiter } from "../../middleware/noteRateLimit";
import { getNotePhotoDir } from "../../middleware/notePhotoUpload";

/**
 * Standalone notes (forgejo#137): a moment with no trip — a date with its
 * zone, a body, optionally where it was written and a photo.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

describe("Notes API", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/notes").set("Cookie", as).send(body);

  const base = {
    body: "Erster Schnee auf dem Wendelstein.",
    occurredAt: { local: "2026-09-28T00:30", zone: "Europe/Berlin" },
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["notestest", "notesother"] } } });
    const user = await prisma.user.create({
      data: { username: "notestest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "notesother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterEach(async () => {
    const withPhotos = await prisma.note.findMany({
      where: { userId: { in: [userId, otherUserId] }, photoFilename: { not: null } },
      select: { photoFilename: true },
    });
    for (const { photoFilename } of withPhotos) {
      const file = path.join(getNotePhotoDir(), path.basename(photoFilename!));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    await prisma.note.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await noteCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("stores the wall clock as a real instant with the zone it was written in, enveloped", async () => {
    const res = await create(base);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const note = res.body.data;
    expect(note.body).toBe(base.body);
    // 00:30 in Berlin on the 28th is 22:30 UTC on the 27th …
    expect(note.occurredAt).toBe("2026-09-27T22:30:00.000Z");
    expect(note.occurredZone).toBe("Europe/Berlin");
    expect(note.times.occurredAt).toMatchObject({
      local: "2026-09-28T00:30:00",
      zone: "Europe/Berlin",
      offset: "+02:00",
      precision: "minute",
    });
    // … and the note belongs to the 28th, the day where it was written.
    expect(note.times.day).toEqual({ date: "2026-09-28", zone: "Europe/Berlin", precision: "day" });
    expect(note.photo).toBeNull();
    expect(note).not.toHaveProperty("photoFilename");
  });

  it("reads an instant in the zone the client says it was written in", async () => {
    const res = await create({
      body: "Late dinner",
      occurredAt: "2026-09-27T22:30:00.000Z",
      zone: "Europe/Berlin",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.times.day.date).toBe("2026-09-28");
  });

  it("takes the zone from the position when nothing else names one", async () => {
    const res = await create({
      body: "Sunset over Bayrischzell",
      occurredAt: { local: "2026-09-27T19:14" },
      placeName: "Bayrischzell",
      lat: 47.67,
      lon: 11.99,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.occurredZone).toBe("Europe/Berlin");
    expect(res.body.data.placeName).toBe("Bayrischzell");
  });

  it("refuses an instant with no zone anywhere instead of guessing UTC", async () => {
    const res = await create({ body: "x", occurredAt: "2026-09-27T22:30:00.000Z" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TZ_UNRESOLVED");
    expect(await prisma.note.count({ where: { userId } })).toBe(0);
  });

  it("refuses an offset-less datetime string, which the host would have to interpret", async () => {
    const res = await create({ body: "x", occurredAt: "2026-09-27T22:30", zone: "Europe/Berlin" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TIME_SHAPE_REQUIRED");
  });

  it("refuses an unknown zone with its code", async () => {
    const res = await create({
      body: "x",
      occurredAt: { local: "2026-09-27T10:00", zone: "Mars/Olympus" },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ZONE_UNKNOWN");
  });

  it("stores a note dated to the day with precision day", async () => {
    const res = await create({
      body: "Somewhere in May",
      occurredAt: "2026-05-02",
      zone: "Asia/Tokyo",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.occurredPrecision).toBe("day");
    expect(res.body.data.times.day.date).toBe("2026-05-02");
    expect(res.body.data.times.occurredAt.precision).toBe("day");
  });

  it("refuses an empty body and half a coordinate", async () => {
    expect((await create({ ...base, body: "   " })).status).toBe(400);
    expect((await create({ ...base, lat: 47.6 })).status).toBe(400);
    expect(await prisma.note.count({ where: { userId } })).toBe(0);
  });

  it("answers a resend under the same clientId with the note on file, not a second one", async () => {
    const first = await create({ ...base, clientId: "m-1" });
    const again = await create({ ...base, body: "changed in transit", clientId: "m-1" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await prisma.note.count({ where: { userId } })).toBe(1);
    // Another account's identical client id is its own note.
    expect((await create({ ...base, clientId: "m-1" }, otherCookie)).status).toBe(201);
  });

  it("lists the caller's notes newest first with a stable tie-break, and nobody else's", async () => {
    await create({ ...base, occurredAt: { local: "2026-01-01T10:00", zone: "UTC" } });
    await create({ ...base, occurredAt: { local: "2026-03-01T10:00", zone: "UTC" } });
    await create({ ...base, occurredAt: { local: "2026-03-01T10:00", zone: "UTC" } });
    await create(base, otherCookie);

    const res = await request(app).get("/api/v1/notes?limit=2").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 3, limit: 2, offset: 0 });
    expect(res.body.data.map((n: { occurredAt: string }) => n.occurredAt)).toEqual([
      "2026-03-01T10:00:00.000Z",
      "2026-03-01T10:00:00.000Z",
    ]);
    const rest = await request(app).get("/api/v1/notes?limit=2&offset=2").set("Cookie", cookie);
    expect(rest.body.data).toHaveLength(1);
    const ids = [...res.body.data, ...rest.body.data].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("edits the body and the place without moving the moment", async () => {
    const { body } = await create(base);
    const res = await request(app)
      .patch(`/api/v1/notes/${body.data.id}`)
      .set("Cookie", cookie)
      .send({ body: "Edited", placeName: "Wendelstein", lat: 47.7, lon: 12.01 });
    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe("Edited");
    expect(res.body.data.placeName).toBe("Wendelstein");
    expect(res.body.data.occurredAt).toBe(body.data.occurredAt);
    expect(res.body.data.occurredZone).toBe("Europe/Berlin");
  });

  it("re-reads the moment when occurredAt is sent, and refuses a zone sent alone", async () => {
    const { body } = await create(base);
    const moved = await request(app)
      .patch(`/api/v1/notes/${body.data.id}`)
      .set("Cookie", cookie)
      .send({ occurredAt: { local: "2026-09-28T00:30", zone: "Asia/Tokyo" } });
    expect(moved.body.data.occurredAt).toBe("2026-09-27T15:30:00.000Z");
    const alone = await request(app)
      .patch(`/api/v1/notes/${body.data.id}`)
      .set("Cookie", cookie)
      .send({ zone: "Europe/London" });
    expect(alone.status).toBe(400);
  });

  it("hides another account's note behind a 404 on every route", async () => {
    const { body } = await create(base, otherCookie);
    const id = body.data.id;
    expect((await request(app).get(`/api/v1/notes/${id}`).set("Cookie", cookie)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/v1/notes/${id}`).set("Cookie", cookie).send({ body: "x" }))
        .status
    ).toBe(404);
    expect((await request(app).delete(`/api/v1/notes/${id}`).set("Cookie", cookie)).status).toBe(
      404
    );
    expect((await request(app).get(`/api/v1/notes/${id}/photo`).set("Cookie", cookie)).status).toBe(
      404
    );
    expect(await prisma.note.count({ where: { id } })).toBe(1);
  });

  it("keeps, serves privately, replaces and removes a photo — and its file", async () => {
    const { body } = await create(base);
    const id = body.data.id;
    const before = fs.readdirSync(getNotePhotoDir()).length;

    const put = await request(app)
      .put(`/api/v1/notes/${id}/photo`)
      .set("Cookie", cookie)
      .attach("photo", PNG, "sunset.png");
    expect(put.status).toBe(200);
    expect(put.body.data.photo).toMatchObject({ mimetype: "image/png", sizeBytes: PNG.length });
    expect(put.body.data.photo.url).toMatch(new RegExp(`^/api/v1/notes/${id}/photo\\?v=\\d+$`));
    expect(fs.readdirSync(getNotePhotoDir()).length).toBe(before + 1);

    const got = await request(app).get(`/api/v1/notes/${id}/photo`).set("Cookie", cookie);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toMatch(/^image\/png/);
    expect(got.headers["cache-control"]).toBe("private, max-age=3600");

    const replaced = await request(app)
      .put(`/api/v1/notes/${id}/photo`)
      .set("Cookie", cookie)
      .attach("photo", PNG, "again.png");
    expect(replaced.status).toBe(200);
    // The first file went with the replacement.
    expect(fs.readdirSync(getNotePhotoDir()).length).toBe(before + 1);

    const removed = await request(app).delete(`/api/v1/notes/${id}/photo`).set("Cookie", cookie);
    expect(removed.body.data.photo).toBeNull();
    expect(fs.readdirSync(getNotePhotoDir()).length).toBe(before);
  });

  it("refuses a non-image photo and leaves nothing on disk", async () => {
    const { body } = await create(base);
    const before = fs.readdirSync(getNotePhotoDir()).length;
    const res = await request(app)
      .put(`/api/v1/notes/${body.data.id}/photo`)
      .set("Cookie", cookie)
      .attach("photo", Buffer.from("%PDF-1.4"), {
        filename: "a.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(fs.readdirSync(getNotePhotoDir()).length).toBe(before);
  });

  it("deletes a note together with its photo file", async () => {
    const { body } = await create(base);
    const id = body.data.id;
    await request(app)
      .put(`/api/v1/notes/${id}/photo`)
      .set("Cookie", cookie)
      .attach("photo", PNG, "sunset.png");
    const stored = await prisma.note.findUniqueOrThrow({ where: { id } });
    const file = path.join(getNotePhotoDir(), stored.photoFilename!);
    expect(fs.existsSync(file)).toBe(true);

    const res = await request(app).delete(`/api/v1/notes/${id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(await prisma.note.count({ where: { id } })).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("puts a written note into the sync feed", async () => {
    const { body } = await create(base);
    const change = await prisma.syncChange.findFirst({
      where: { entity: "note", entityId: body.data.id },
    });
    expect(change).not.toBeNull();
  });
});

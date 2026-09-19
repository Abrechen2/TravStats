import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getTrainingUploadDir } from "../training";

/**
 * A training sample can be found again, and removed again.
 *
 * `routes/training.ts` served upload, read-by-id and annotate and nothing
 * else (beta API audit of 2026-09-19, unlisted finding 3). So the id of a
 * sample was handed out exactly once — in the upload response — and once the
 * annotation view closed there was no route that could reach it. The auditor's
 * own sample is still sitting on the public beta under the admin account for
 * that reason.
 *
 * It matters because a sample is a COPY of a real document: the file stays on
 * the data volume, and a mail's whole text, or a boarding pass as base64,
 * stays in a jsonb column beside it. "Uploaded it by mistake" has to have an
 * undo.
 *
 * The 404-not-403 case is the one worth reading twice: refusing another
 * user's id with 403 would answer the question "does this id exist?", which is
 * the only thing an id is secret about.
 */
describe("GET /api/v1/training and DELETE /api/v1/training/:id", () => {
  const ids: string[] = [];
  let ownerCookie: string;
  let strangerCookie: string;
  let demoCookie: string;
  let ownerId: string;

  /** id to the file written for it, so a delete can be measured on disk. */
  const files = new Map<string, string>();

  const seedSample = async (userId: string, name: string, createdAt: Date): Promise<string> => {
    const file = path.join(getTrainingUploadDir(), `jest-${name}-${Date.now()}.txt`);
    fs.writeFileSync(file, "sample bytes");
    const record = await prisma.trainingData.create({
      data: {
        userId,
        type: "email",
        domain: "flight",
        originalFile: file,
        annotations: { fullText: "From: someone\nSubject: booking" },
        extractedData: [],
        status: "pending",
        tags: [],
        createdAt,
      },
      select: { id: true },
    });
    files.set(record.id, file);
    return record.id;
  };

  let older: string;
  let newer: string;
  let strangers: string;

  beforeAll(async () => {
    const stamp = Date.now();
    await prisma.user.deleteMany({ where: { username: "demo" } });
    const owner = await prisma.user.create({
      data: {
        username: `training-owner-${stamp}`,
        passwordHash: await hashPassword("test-password"),
      },
    });
    const stranger = await prisma.user.create({
      data: {
        username: `training-stranger-${stamp}`,
        passwordHash: await hashPassword("test-password"),
      },
    });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    ids.push(owner.id, stranger.id, demo.id);
    ownerId = owner.id;
    ownerCookie = `auth_token=${generateToken(owner.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    demoCookie = `auth_token=${generateToken(demo.id)}`;

    older = await seedSample(owner.id, "older", new Date("2026-01-01T00:00:00Z"));
    newer = await seedSample(owner.id, "newer", new Date("2026-02-01T00:00:00Z"));
    strangers = await seedSample(stranger.id, "stranger", new Date("2026-03-01T00:00:00Z"));
  });

  afterAll(async () => {
    for (const file of files.values()) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Already removed by the test that was measuring exactly that.
      }
    }
    await prisma.trainingData.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("lists the caller's own samples, newest first, and nobody else's", async () => {
    const res = await request(app).get("/api/v1/training").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    const listed = (res.body.samples as Array<{ id: string }>).map((s) => s.id);
    expect(listed).toEqual([newer, older]);
    expect(listed).not.toContain(strangers);
  });

  it("carries the fields a list needs and none of the blobs", async () => {
    const res = await request(app).get("/api/v1/training").set("Cookie", ownerCookie);
    const sample = (res.body.samples as Array<Record<string, unknown>>)[0];
    expect(Object.keys(sample).sort()).toEqual(
      ["createdAt", "domain", "filename", "id", "status", "tags", "type"].sort()
    );
    // The filename, never the path the data volume is laid out with.
    expect(String(sample.filename)).not.toContain(path.sep);
  });

  it("bounds the work with the limit it was asked for", async () => {
    const res = await request(app).get("/api/v1/training?limit=1").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.samples).toHaveLength(1);
    expect(res.body.samples[0].id).toBe(newer);
  });

  it("refuses a limit outside the bound rather than honouring it", async () => {
    const res = await request(app).get("/api/v1/training?limit=5000").set("Cookie", ownerCookie);
    expect(res.status).toBe(400);
  });

  it("deletes the sample: the row and the file behind it", async () => {
    const file = files.get(older)!;
    expect(fs.existsSync(file)).toBe(true);

    const res = await request(app).delete(`/api/v1/training/${older}`).set("Cookie", ownerCookie);
    expect(res.status).toBe(204);

    expect(await prisma.trainingData.findUnique({ where: { id: older } })).toBeNull();
    expect(fs.existsSync(file)).toBe(false);

    const gone = await request(app).get(`/api/v1/training/${older}`).set("Cookie", ownerCookie);
    expect(gone.status).toBe(404);
  });

  it("answers another user's id with 404, never 403, and leaves it alone", async () => {
    const res = await request(app)
      .delete(`/api/v1/training/${strangers}`)
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(404);
    // The route's own answer, indistinguishable from an id that never existed.
    expect(res.body.error).toBe("Training data not found");

    // Still there, and still the stranger's.
    const survivor = await prisma.trainingData.findUnique({ where: { id: strangers } });
    expect(survivor).not.toBeNull();
    expect(fs.existsSync(files.get(strangers)!)).toBe(true);

    // The same answer for an id nobody owns, so the two cannot be told apart.
    const unknown = await request(app)
      .delete("/api/v1/training/00000000-0000-0000-0000-000000000000")
      .set("Cookie", ownerCookie);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe(res.body.error);
  });

  it("shows the stranger their own sample and only that one", async () => {
    const res = await request(app).get("/api/v1/training").set("Cookie", strangerCookie);
    expect(res.status).toBe(200);
    expect((res.body.samples as Array<{ id: string }>).map((s) => s.id)).toEqual([strangers]);
  });

  it("refuses the delete for the shared demo account, as the upload route does", async () => {
    const own = await seedSample(ownerId, "demo-probe", new Date("2026-04-01T00:00:00Z"));
    const res = await request(app).delete(`/api/v1/training/${own}`).set("Cookie", demoCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    // Refused before the lookup, so nothing of anybody's was touched.
    expect(await prisma.trainingData.findUnique({ where: { id: own } })).not.toBeNull();
  });
});

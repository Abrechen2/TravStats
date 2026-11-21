import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import { __resetArchiveJobs } from "../../services/accountArchive/archiveJobs";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";

/**
 * forgejo#433 — the account archive's HTTP surface: an export runs as a job whose
 * download only its owner can fetch, and an import into an account that already
 * holds data is refused as the job's outcome.
 */

const made: string[] = [];
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "az-routes-"));
process.env.ACCOUNT_ARCHIVE_DIR = workDir;

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      username: `az-route-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "x",
    },
  });
  made.push(user.id);
  await prisma.userSettings.create({ data: { userId: user.id, data: {} } });
  return { id: user.id, cookie: `auth_token=${generateToken(user.id)}` };
}

async function jobOf(cookie: string, jobId: string) {
  await settleAllJobs();
  const res = await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie);
  return res.body.data;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  __resetArchiveJobs();
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("account archive routes", () => {
  it("refuses an anonymous caller", async () => {
    expect((await request(app).post("/api/v1/me/account-archive/export")).status).toBe(401);
    expect((await request(app).get("/api/v1/me/account-archive")).status).toBe(401);
  });

  it("exports as a job and lets only the owner download the ZIP", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    await prisma.flight.create({
      data: { userId: a.id, depLat: 1, depLon: 2, arrLat: 3, arrLon: 4 },
    });

    const started = await request(app)
      .post("/api/v1/me/account-archive/export")
      .set("Cookie", a.cookie);
    expect(started.status).toBe(202);
    const job = await jobOf(a.cookie, started.body.data.jobId);
    expect(job.status).toBe("succeeded");
    expect(job.result.tables.flights).toBe(1);

    const url = `/api/v1/me/account-archive/export/${job.result.exportId}`;
    expect((await request(app).get(url).set("Cookie", b.cookie)).status).toBe(404);
    const download = await request(app)
      .get(url)
      .set("Cookie", a.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect((download.body as Buffer).subarray(0, 2).toString()).toBe("PK");

    // b is empty and can take it; a holds data and cannot.
    expect(
      (await request(app).get("/api/v1/me/account-archive").set("Cookie", b.cookie)).body.data.empty
    ).toBe(true);
    expect(
      (await request(app).get("/api/v1/me/account-archive").set("Cookie", a.cookie)).body.data.empty
    ).toBe(false);

    const zipFile = path.join(workDir, "download.zip");
    fs.writeFileSync(zipFile, download.body as Buffer);
    const refused = await request(app)
      .post("/api/v1/me/account-archive/import")
      .set("Cookie", a.cookie)
      .attach("archive", zipFile);
    expect(refused.status).toBe(202);
    const failed = await jobOf(a.cookie, refused.body.data.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error.code).toBe("ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY");

    const imported = await request(app)
      .post("/api/v1/me/account-archive/import")
      .set("Cookie", b.cookie)
      .attach("archive", zipFile);
    const done = await jobOf(b.cookie, imported.body.data.jobId);
    expect(done.status).toBe("succeeded");
    expect(await prisma.flight.count({ where: { userId: b.id } })).toBe(1);
    // The uploads are gone once their job ended.
    expect(fs.readdirSync(workDir).filter((n) => n.endsWith(".upload"))).toEqual([]);
  });

  it("refuses an import without a file", async () => {
    const a = await makeUser("c");
    const res = await request(app)
      .post("/api/v1/me/account-archive/import")
      .set("Cookie", a.cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_ARCHIVE_INVALID");
  });

  it("refuses a read-scoped token, and any token for an import", async () => {
    const a = await makeUser("tok");
    const bearer = async (scope: "read" | "write") => {
      const tok = await generateApiToken();
      await prisma.apiToken.create({
        data: {
          userId: a.id,
          label: `az-${scope}`,
          lookupHash: tok.lookupHash,
          hash: tok.hash,
          scope,
        },
      });
      return `Bearer ${tok.plaintext}`;
    };
    const read = await bearer("read");
    expect(
      (await request(app).post("/api/v1/me/account-archive/export").set("Authorization", read))
        .status
    ).toBe(403);
    const write = await bearer("write");
    expect(
      (await request(app).post("/api/v1/me/account-archive/import").set("Authorization", write))
        .status
    ).toBe(403);
  });

  it("refuses the shared demo account", async () => {
    if (await prisma.user.findUnique({ where: { username: "demo" } })) return;
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: "x", isDemo: true },
    });
    made.push(demo.id);
    const cookie = `auth_token=${generateToken(demo.id)}`;
    expect(
      (await request(app).post("/api/v1/me/account-archive/export").set("Cookie", cookie)).status
    ).toBe(403);
    expect(
      (await request(app).post("/api/v1/me/account-archive/import").set("Cookie", cookie)).status
    ).toBe(403);
  });
});

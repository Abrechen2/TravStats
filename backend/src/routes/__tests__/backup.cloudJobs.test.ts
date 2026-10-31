import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";

// The backup directory is read once, when backupConfig loads.
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-jobs-"));
process.env.BACKUP_PATH = BASE;

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * The WebDAV backup upload and download run as jobs (forgejo#354 follow-ups).
 * Both used to hold the request open for the whole transfer while the browser
 * gave up after ten seconds: a still-running upload was reported as failed.
 * These pin what the client now reads on the job — progress while it runs, and
 * for every failure its own stable cause — and that a verified download lands
 * in the backup list while a truncated or mismatched one leaves nothing.
 */

jest.mock("../../services/instanceSettingsService", () => ({
  ...jest.requireActual("../../services/instanceSettingsService"),
  getWebDAVSettings: jest.fn(async () => ({
    enabled: true,
    url: "https://share.test/dav",
    username: "u",
    password: "p",
    backupPath: "/TravStats/backups/",
  })),
}));
jest.mock("../../services/backupService", () => ({
  ...jest.requireActual("../../services/backupService"),
  restoreBackup: jest.fn(async () => undefined),
}));

interface ShareFile {
  body: Buffer;
  /** Content-Length the share promises; defaults to the body length. */
  promised?: number;
}
let share: Record<string, ShareFile> = {};
let putFailure: unknown = null;
let holdDownload: Promise<void> | null = null;
let holdUpload: Promise<void> | null = null;
const putCalls: Array<{ path: string; body: unknown }> = [];

jest.mock("webdav", () => ({
  createClient: () => ({
    createDirectory: async () => undefined,
    deleteFile: async () => undefined,
    putFileContents: async (remote: string, body: unknown) => {
      putCalls.push({ path: remote, body });
      if (holdUpload) await holdUpload;
      if (putFailure && !remote.endsWith(".sha256")) throw putFailure;
      if (typeof body === "string") share[remote] = { body: Buffer.from(body) };
      return true;
    },
    getFileContents: async (remote: string) => {
      const file = share[remote];
      if (!file) throw Object.assign(new Error("404 Not Found"), { status: 404 });
      return file.body.toString("utf8");
    },
    createReadStream: (
      remote: string,
      options?: { callback?: (r: { headers: Headers }) => void }
    ) => {
      const file = share[remote];
      const out = new Readable({ read() {} });
      setTimeout(() => {
        if (!file) {
          out.destroy(Object.assign(new Error("404 Not Found"), { status: 404 }));
          return;
        }
        options?.callback?.({
          headers: new Headers({ "content-length": String(file.promised ?? file.body.length) }),
        });
        void (async () => {
          if (holdDownload) await holdDownload;
          out.push(file.body);
          out.push(null);
        })();
      }, 0);
      return out;
    },
  }),
}));

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const REMOTE = (name: string) => `/TravStats/backups/${name}`;
const ARCHIVE = Buffer.from("pretend this is a tar.gz archive");

describe("WebDAV backup upload and download are jobs", () => {
  let adminId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "cloud-job-admin" } });
    const user = await prisma.user.create({
      data: {
        username: "cloud-job-admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    clearJobs();
    share = {};
    putFailure = null;
    holdDownload = null;
    holdUpload = null;
    putCalls.length = 0;
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-cj-" } } });
    for (const entry of fs.readdirSync(BASE))
      fs.rmSync(path.join(BASE, entry), { recursive: true });
  });

  afterAll(async () => {
    await settleAllJobs().catch(() => undefined);
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-cj-" } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    fs.rmSync(BASE, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  const poll = async (jobId: string) =>
    (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie)).body.data;
  const download = (name: string) =>
    request(app)
      .post("/api/v1/backup/cloud/download")
      .set("Cookie", cookie)
      .send({ backupName: name });
  const sync = (id: string) => request(app).post(`/api/v1/backup/${id}/sync`).set("Cookie", cookie);

  async function localBackup(id: string): Promise<string> {
    const dir = path.join(BASE, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.tar.gz`);
    fs.writeFileSync(file, ARCHIVE);
    await prisma.backup.create({
      data: { id, status: "completed", backupPath: file, completedAt: new Date() },
    });
    return file;
  }

  describe("download", () => {
    it("a download whose bytes match the stored checksum lands in the backup list and restores through the normal path", async () => {
      const name = "backup-cj-ok.tar.gz";
      share[REMOTE(name)] = { body: ARCHIVE };
      share[`${REMOTE(name)}.sha256`] = { body: Buffer.from(`${sha(ARCHIVE)}  ${name}\n`) };

      const started = await download(name);
      expect(started.status).toBe(202);
      await settleAllJobs();

      expect(await poll(started.body.data.jobId)).toMatchObject({
        kind: "backup.cloudDownload",
        status: "succeeded",
        result: { backupId: "backup-cj-ok", verified: true },
      });
      const list = await request(app).get("/api/v1/backup").set("Cookie", cookie);
      const row = list.body.backups.find((b: { id: string }) => b.id === "backup-cj-ok");
      expect(row).toMatchObject({ status: "completed", syncedToCloud: true });
      const detail = await request(app).get("/api/v1/backup/backup-cj-ok").set("Cookie", cookie);
      expect(detail.body.backup.fileExists).toBe(true);
      expect(row.metadata).toMatchObject({ source: "webdav", verification: "sha256" });
      // Its own directory: deleting this backup must not take the others along.
      expect(fs.existsSync(path.join(BASE, "backup-cj-ok", name))).toBe(true);

      const restore = await request(app)
        .post("/api/v1/backup/backup-cj-ok/restore")
        .set("Cookie", cookie)
        .send({ scope: "full", createBackupBefore: false });
      expect(restore.status).toBe(202);
      await settleAllJobs();
    });

    it("a download whose bytes differ from the stored checksum fails its job with the mismatch code and leaves no row and no file", async () => {
      const name = "backup-cj-bad.tar.gz";
      const corrupted = Buffer.from("pretend this is a tar.gz archivX"); // same length
      share[REMOTE(name)] = { body: corrupted };
      share[`${REMOTE(name)}.sha256`] = { body: Buffer.from(`${sha(ARCHIVE)}  ${name}\n`) };

      const started = await download(name);
      await settleAllJobs();

      expect((await poll(started.body.data.jobId)).error).toEqual({
        code: "WEBDAV_DOWNLOAD_CHECKSUM_MISMATCH",
        status: 502,
      });
      expect(await prisma.backup.findUnique({ where: { id: "backup-cj-bad" } })).toBeNull();
      expect(fs.existsSync(path.join(BASE, "backup-cj-bad"))).toBe(false);
    });

    it("a body shorter than its Content-Length fails its job as truncated and leaves no row and no file", async () => {
      const name = "backup-cj-cut.tar.gz";
      share[REMOTE(name)] = { body: ARCHIVE, promised: ARCHIVE.length + 100 };

      const started = await download(name);
      await settleAllJobs();

      expect((await poll(started.body.data.jobId)).error).toEqual({
        code: "WEBDAV_DOWNLOAD_TRUNCATED",
        status: 502,
      });
      expect(await prisma.backup.findUnique({ where: { id: "backup-cj-cut" } })).toBeNull();
      expect(fs.existsSync(path.join(BASE, "backup-cj-cut"))).toBe(false);
    });

    it("an archive uploaded before checksums existed is accepted on its size and marked unverified", async () => {
      const name = "backup-cj-old.tar.gz";
      share[REMOTE(name)] = { body: ARCHIVE };

      const started = await download(name);
      await settleAllJobs();

      expect((await poll(started.body.data.jobId)).result).toEqual({
        backupId: "backup-cj-old",
        verified: false,
      });
      const row = await prisma.backup.findUnique({ where: { id: "backup-cj-old" } });
      expect(row?.metadata).toMatchObject({ verification: "size" });
    });

    it("a missing file on the share fails its job as not-on-share, not as a generic failure", async () => {
      const started = await download("backup-cj-gone.tar.gz");
      await settleAllJobs();
      expect((await poll(started.body.data.jobId)).error).toEqual({
        code: "WEBDAV_BACKUP_NOT_ON_SHARE",
        status: 404,
      });
    });

    it("a name already in the backup list is refused with 409 before any byte moves", async () => {
      await localBackup("backup-cj-dup");
      share[REMOTE("backup-cj-dup.tar.gz")] = { body: ARCHIVE };
      const res = await download("backup-cj-dup.tar.gz");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("WEBDAV_BACKUP_EXISTS");
    });
  });

  describe("upload", () => {
    it("answers 202 while the upload is still running, and the job reads running until it ends", async () => {
      await localBackup("backup-cj-up");
      let release!: () => void;
      holdUpload = new Promise<void>((resolve) => (release = resolve));

      const started = await sync("backup-cj-up");
      expect(started.status).toBe(202);
      expect(await poll(started.body.data.jobId)).toMatchObject({ status: "running", error: null });

      release();
      await settleAllJobs();
      expect(await poll(started.body.data.jobId)).toMatchObject({
        kind: "backup.cloudSync",
        status: "succeeded",
      });
      const row = await prisma.backup.findUnique({ where: { id: "backup-cj-up" } });
      expect(row?.syncedToCloud).toBe(true);
      // The checksum file went up beside the archive, in sha256sum format.
      const sidecar = putCalls.find((c) => c.path.endsWith(".sha256"));
      expect(sidecar?.body).toBe(`${sha(ARCHIVE)}  backup-cj-up.tar.gz\n`);
    });

    it.each([
      [
        "a refused password",
        Object.assign(new Error("401 Unauthorized"), { status: 401 }),
        "WEBDAV_BACKUP_AUTH",
      ],
      [
        "a full share",
        Object.assign(new Error("507 Insufficient Storage"), { status: 507 }),
        "WEBDAV_BACKUP_QUOTA",
      ],
      [
        "a share that takes too long",
        Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        "WEBDAV_BACKUP_TIMEOUT",
      ],
      [
        "a share nobody answers for",
        Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
        "WEBDAV_BACKUP_UNREACHABLE",
      ],
      [
        "a share that answers 500",
        Object.assign(new Error("500"), { status: 500 }),
        "WEBDAV_BACKUP_SHARE_ERROR",
      ],
    ])(
      "%s fails the upload job with its own code and leaves the row unsynced",
      async (_label, failure, code) => {
        await localBackup("backup-cj-fail");
        putFailure = failure;

        const started = await sync("backup-cj-fail");
        await settleAllJobs();

        const job = await poll(started.body.data.jobId);
        expect(job.status).toBe("failed");
        expect(job.error).toMatchObject({ code, status: 502 });
        expect(
          (await prisma.backup.findUnique({ where: { id: "backup-cj-fail" } }))?.syncedToCloud
        ).toBe(false);
      }
    );

    it("an unknown backup is a 404 and an unfinished one a 400, with no job", async () => {
      expect((await sync("backup-cj-nope")).status).toBe(404);
      await prisma.backup.create({
        data: { id: "backup-cj-run", status: "running", backupPath: path.join(BASE, "x.tar.gz") },
      });
      expect((await sync("backup-cj-run")).status).toBe(400);
    });
  });

  it("only one upload or download runs at a time; the second is refused with 409 and a reason", async () => {
    const name = "backup-cj-slow.tar.gz";
    share[REMOTE(name)] = { body: ARCHIVE };
    let release!: () => void;
    holdDownload = new Promise<void>((resolve) => (release = resolve));
    await localBackup("backup-cj-other");

    const first = await download(name);
    expect(first.status).toBe(202);

    const second = await download("backup-cj-second.tar.gz");
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("WEBDAV_BACKUP_BUSY");
    const upload = await sync("backup-cj-other");
    expect(upload.status).toBe(409);
    expect(upload.body.code).toBe("WEBDAV_BACKUP_BUSY");

    release();
    await settleAllJobs();
    expect((await poll(first.body.data.jobId)).status).toBe("succeeded");
  });
});

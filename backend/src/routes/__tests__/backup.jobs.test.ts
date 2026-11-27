import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Backup and restore run as background jobs (silent-failure fixes,
 * 2026-09-26). Both used to hold the request open for the whole pg_dump /
 * psql / tar run while the browser gave up after ten seconds: the admin read
 * "restore failed" over a restore that completed, and the second click met
 * the route's own 409. These pin what the client now reads — a job handle at
 * once, and the real outcome (success, or the preflight's own code) on it.
 *
 * The heavy service calls are replaced by promises the test settles by hand,
 * so "still running" is an observable state rather than a race.
 */

let releaseRestore: (() => void) | null = null;
let failRestore: ((err: Error) => void) | null = null;

jest.mock("../../services/backupService", () => {
  const actual = jest.requireActual("../../services/backupService");
  return {
    ...actual,
    restoreBackup: jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          releaseRestore = resolve;
          failRestore = reject;
        })
    ),
    createBackup: jest.fn(async () => "backup-job-test-created"),
  };
});

describe("backup and restore answer with a job, and the job carries the real outcome", () => {
  let adminId: string;
  let otherAdminId: string;
  let adminCookie: string;
  let otherCookie: string;
  let archivePath: string;
  const backupId = "backup-job-test";

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["backup-job-a", "backup-job-b"] } } });
    const make = async (username: string) =>
      prisma.user.create({
        data: {
          username,
          passwordHash: await hashPassword("password123"),
          isAdmin: true,
          isActive: true,
        },
      });
    const a = await make("backup-job-a");
    const b = await make("backup-job-b");
    adminId = a.id;
    otherAdminId = b.id;
    adminCookie = `auth_token=${generateToken(a.id)}`;
    otherCookie = `auth_token=${generateToken(b.id)}`;

    archivePath = path.join(os.tmpdir(), `${backupId}.tar.gz`);
    fs.writeFileSync(archivePath, "not really an archive");
  });

  beforeEach(async () => {
    clearJobs();
    releaseRestore = null;
    failRestore = null;
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-" } } });
    await prisma.backup.create({
      data: { id: backupId, status: "completed", backupPath: archivePath, completedAt: new Date() },
    });
  });

  afterAll(async () => {
    await settleAllJobs().catch(() => undefined);
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-" } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, otherAdminId] } } });
    fs.rmSync(archivePath, { force: true });
    await prisma.$disconnect();
  });

  const poll = (jobId: string, cookie = adminCookie) =>
    request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie);

  it("a restore answers 202 at once and its job reads running, then succeeded", async () => {
    const started = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", adminCookie)
      .send({ scope: "full", createBackupBefore: false });

    expect(started.status).toBe(202);
    const { jobId } = started.body.data;
    expect((await poll(jobId)).body.data).toMatchObject({ status: "running", error: null });

    // A second click while it runs is refused — but now the first one is
    // visibly still going, so the admin has no reason to click again.
    const second = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", adminCookie)
      .send({ scope: "full", createBackupBefore: false });
    expect(second.status).toBe(409);
    // A backup cannot start under a running restore either.
    expect(
      (await request(app).post("/api/v1/backup").set("Cookie", adminCookie).send({})).status
    ).toBe(409);

    releaseRestore!();
    await settleAllJobs();
    expect((await poll(jobId)).body.data).toMatchObject({
      kind: "backup.restore",
      status: "succeeded",
      result: { backupId, scope: "full" },
      error: null,
    });
  });

  it("two restores sent at the same moment: exactly one starts, the other is refused", async () => {
    const send = (cookie: string) =>
      request(app)
        .post(`/api/v1/backup/${backupId}/restore`)
        .set("Cookie", cookie)
        .send({ scope: "full", createBackupBefore: false });
    // Hold the first request inside the route's archive lookup until the second
    // has reached it too — both are then past the early running-job check, the
    // window a check-then-await-then-start route leaves open.
    const service = jest.requireMock("../../services/backupService") as {
      getBackup: (id: string) => Promise<unknown>;
    };
    const realGetBackup = service.getBackup;
    let arrived = 0;
    let bothArrived!: () => void;
    const gate = new Promise<void>((resolve) => (bothArrived = resolve));
    const spy = jest.spyOn(service, "getBackup").mockImplementation(async (id: string) => {
      arrived += 1;
      if (arrived === 2) bothArrived();
      await gate;
      return realGetBackup(id);
    });
    // Two admins, so the per-account restore limiter is not what refuses one.
    const [a, b] = await Promise.all([send(adminCookie), send(otherCookie)]).finally(() =>
      spy.mockRestore()
    );
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    releaseRestore!();
    await settleAllJobs();
    // Give the hourly restore budget back to the tests below.
    const { backupRestoreLimiter } = await import("../../middleware/rateLimit");
    await backupRestoreLimiter.resetKey(`user:${adminId}`);
    await backupRestoreLimiter.resetKey(`user:${otherAdminId}`);
  });

  it("a restore that starts while a backup writes its row wins; the backup is refused and leaves no row", async () => {
    // Hold the backup inside its row transaction — past its own running-job check — until the
    // restore has started: the window a check-then-await-then-start route leaves open.
    const realTransaction = prisma.$transaction.bind(prisma) as (...a: unknown[]) => unknown;
    let entered!: () => void;
    const inTransaction = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation((async (
      ...args: unknown[]
    ) => {
      const opts = args[1] as { isolationLevel?: string } | undefined;
      if (opts?.isolationLevel === "Serializable") {
        entered();
        await held;
      }
      return realTransaction(...args);
    }) as never);
    try {
      const backup = request(app).post("/api/v1/backup").set("Cookie", adminCookie).send({});
      const backupDone = backup.then((r) => r);
      await inTransaction;
      const restore = await request(app)
        .post(`/api/v1/backup/${backupId}/restore`)
        .set("Cookie", otherCookie)
        .send({ scope: "full", createBackupBefore: false });
      expect(restore.status).toBe(202);
      release();
      expect((await backupDone).status).toBe(409);
      expect(await prisma.backup.count({ where: { status: "running" } })).toBe(0);
    } finally {
      spy.mockRestore();
      releaseRestore?.();
      await settleAllJobs();
      const { backupRestoreLimiter } = await import("../../middleware/rateLimit");
      await backupRestoreLimiter.resetKey(`user:${otherAdminId}`);
    }
  });

  it("a restore the preflight refuses fails its job with the refusal's code and status", async () => {
    const started = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", adminCookie)
      .send({ scope: "database", createBackupBefore: false });
    expect(started.status).toBe(202);

    failRestore!(new AppError("key differs", 409, "RESTORE_ENCRYPTION_KEY_MISMATCH"));
    await settleAllJobs();

    const job = (await poll(started.body.data.jobId)).body.data;
    expect(job.status).toBe("failed");
    expect(job.error).toEqual({ code: "RESTORE_ENCRYPTION_KEY_MISMATCH", status: 409 });
  });

  it("an unknown backup is still refused synchronously, with no job", async () => {
    // Another admin: the restore limiter allows three an hour per account.
    const res = await request(app)
      .post("/api/v1/backup/backup-does-not-exist/restore")
      .set("Cookie", otherCookie)
      .send({ scope: "full", createBackupBefore: false });
    expect(res.status).toBe(404);
  });

  it("a created backup answers 202 and its job names the backup it wrote", async () => {
    const started = await request(app).post("/api/v1/backup").set("Cookie", adminCookie).send({});
    expect(started.status).toBe(202);
    await settleAllJobs();
    expect((await poll(started.body.data.jobId)).body.data).toMatchObject({
      kind: "backup.create",
      status: "succeeded",
      result: { backupId: "backup-job-test-created" },
    });
  });

  it("another account cannot read the job — it looks like no job at all", async () => {
    const started = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", otherCookie)
      .send({ scope: "files", createBackupBefore: false });
    expect(started.status).toBe(202);
    expect((await poll(started.body.data.jobId, adminCookie)).status).toBe(404);
    expect((await poll(started.body.data.jobId, otherCookie)).status).toBe(200);
    releaseRestore!();
    await settleAllJobs();
  });
});

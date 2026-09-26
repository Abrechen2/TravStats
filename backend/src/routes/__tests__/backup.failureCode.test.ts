import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { backupFailureCode } from "../../services/backup/backupFailure";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Acceptance 2026-09-26: a backup on a host without pg_dump ended its job in
 * JOB_FAILED, the page said "Fehler beim Erstellen des Backups", and only the
 * server log knew "spawn pg_dump ENOENT". The job now carries the cause as a
 * stable code the page turns into a sentence.
 */

const createBackup = jest.fn();
const restoreBackup = jest.fn();

jest.mock("../../services/backupService", () => {
  const actual = jest.requireActual("../../services/backupService");
  return {
    ...actual,
    createBackup: (...a: unknown[]) => createBackup(...a),
    restoreBackup: (...a: unknown[]) => restoreBackup(...a),
  };
});

describe("a failed backup or restore job names its cause", () => {
  const backupId = "backup-failure-code-test";
  let archivePath: string;
  const cookies: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const names = ["backup-fail-a", "backup-fail-b", "backup-fail-c"];
    await prisma.user.deleteMany({ where: { username: { in: names } } });
    for (const username of names) {
      const u = await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isAdmin: true },
      });
      userIds.push(u.id);
      cookies.push(`auth_token=${generateToken(u.id)}`);
    }
    archivePath = path.join(os.tmpdir(), `${backupId}.tar.gz`);
    fs.writeFileSync(archivePath, "x");
  });

  beforeEach(async () => {
    clearJobs();
    createBackup.mockReset();
    restoreBackup.mockReset();
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-" } } });
    await prisma.backup.create({
      data: { id: backupId, status: "completed", backupPath: archivePath, completedAt: new Date() },
    });
  });

  afterAll(async () => {
    await settleAllJobs().catch(() => undefined);
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-" } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fs.rmSync(archivePath, { force: true });
    await prisma.$disconnect();
  });

  const jobOf = async (jobId: string, cookie: string) =>
    (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie)).body.data;

  it("a backup without pg_dump fails with BACKUP_TOOL_MISSING", async () => {
    createBackup.mockRejectedValue(
      new Error(
        "Failed to start pg_dump: spawn pg_dump ENOENT. Make sure pg_dump is installed and in your PATH, or use Docker for backups."
      )
    );
    const started = await request(app).post("/api/v1/backup").set("Cookie", cookies[0]).send({});
    expect(started.status).toBe(202);
    await settleAllJobs();
    const job = await jobOf(started.body.data.jobId, cookies[0]);
    expect(job.status).toBe("failed");
    expect(job.error).toEqual({ code: "BACKUP_TOOL_MISSING", status: 500 });
  });

  it("a restore that runs out of disk fails with BACKUP_DISK_FULL", async () => {
    restoreBackup.mockRejectedValue(new Error("ENOSPC: no space left on device, write"));
    const started = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", cookies[1])
      .send({ scope: "full", createBackupBefore: false });
    expect(started.status).toBe(202);
    await settleAllJobs();
    expect((await jobOf(started.body.data.jobId, cookies[1])).error.code).toBe("BACKUP_DISK_FULL");
  });

  it("an unrecognised restore failure is RESTORE_FAILED, never the bare JOB_FAILED", async () => {
    restoreBackup.mockRejectedValue(new Error("psql exited with code 3"));
    const started = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", cookies[2])
      .send({ scope: "full", createBackupBefore: false });
    await settleAllJobs();
    expect((await jobOf(started.body.data.jobId, cookies[2])).error.code).toBe("RESTORE_FAILED");
  });
});

describe("backupFailureCode", () => {
  it.each([
    ["Failed to start psql: spawn psql ENOENT", "BACKUP_TOOL_MISSING"],
    [
      "Failed to write backup file: EACCES: permission denied, open '/app/data/backups/x'",
      "BACKUP_PERMISSION_DENIED",
    ],
    [
      "pg_dump exited with code 1: pg_dump: error: connection to server failed: Connection refused",
      "BACKUP_DB_UNREACHABLE",
    ],
    [
      "pg_dump exited with code 1: pg_dump: error: aborting because of server version mismatch",
      "BACKUP_TOOL_VERSION_MISMATCH",
    ],
    ["Backup file is empty", null],
  ])("%s → %s", (message, code) => {
    expect(backupFailureCode(new Error(message))).toBe(code);
  });
});

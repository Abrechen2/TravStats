import * as os from "os";
import * as path from "path";
import request from "supertest";

/**
 * Acceptance D12 (2026-09-26): a failed backup in the history showed no reason
 * — the cause lived in a toast that was gone by the next visit. The row now
 * stores the reason as a code, and the list answers it for older rows too.
 */

process.env.BACKUP_PATH = path.join(os.tmpdir(), `travstats-backup-reason-${process.pid}`);

jest.mock("../../services/backup/backupDatabase", () => ({
  createDatabaseDump: jest.fn(async () => {
    throw new Error(
      "Failed to start pg_dump: spawn pg_dump ENOENT. Make sure pg_dump is installed and in your PATH, or use Docker for backups."
    );
  }),
}));

import app from "../../index";
import { prisma } from "../../db";
import { createBackup } from "../../services/backupService";
import { backupRowFailureCode } from "../../services/backup/backupFailure";
import { reconcileInterruptedBackups } from "../../services/backup/reconcileBackups";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

describe("a failed backup keeps its reason", () => {
  let cookie: string;
  let adminId: string;
  const created: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "backup-reason-admin" } });
    const admin = await prisma.user.create({
      data: {
        username: "backup-reason-admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    adminId = admin.id;
    cookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterAll(async () => {
    await prisma.backup.deleteMany({ where: { id: { in: created } } });
    await prisma.backup.deleteMany({ where: { id: { startsWith: "backup-reason-" } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("stores the cause of a failed backup on its row, and lists it", async () => {
    const before = new Set(
      (await prisma.backup.findMany({ select: { id: true } })).map((b) => b.id)
    );
    await expect(createBackup()).rejects.toThrow(/pg_dump/);
    const row = await prisma.backup.findFirstOrThrow({
      where: { id: { notIn: [...before] } },
    });
    created.push(row.id);
    expect(row).toMatchObject({ status: "failed", errorCode: "BACKUP_TOOL_MISSING" });

    const list = await request(app).get("/api/v1/backup").set("Cookie", cookie);
    const listed = list.body.backups.find((b: { id: string }) => b.id === row.id);
    expect(listed).toMatchObject({ status: "failed", errorCode: "BACKUP_TOOL_MISSING" });
  });

  it("marks a backup cut off by a restart as interrupted", async () => {
    await prisma.backup.create({
      data: { id: "backup-reason-running", status: "running", backupPath: "/nowhere" },
    });
    await reconcileInterruptedBackups("server restarted");
    const row = await prisma.backup.findUniqueOrThrow({ where: { id: "backup-reason-running" } });
    expect(row).toMatchObject({ status: "failed", errorCode: "BACKUP_INTERRUPTED" });
  });

  it("answers a reason for a row written before the column existed", () => {
    const legacy = (errorMessage: string | null) =>
      backupRowFailureCode({ status: "failed", errorCode: null, errorMessage });
    expect(legacy("Failed to start pg_dump: spawn pg_dump ENOENT")).toBe("BACKUP_TOOL_MISSING");
    expect(legacy("Interrupted: server restarted")).toBe("BACKUP_INTERRUPTED");
    expect(legacy("something odd")).toBe("BACKUP_FAILED");
    expect(
      backupRowFailureCode({ status: "completed", errorCode: null, errorMessage: null })
    ).toBeNull();
  });
});

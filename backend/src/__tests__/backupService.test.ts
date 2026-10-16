import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Mock prisma
const mockBackupFindMany =
  jest.fn<
    (
      args: import("../prisma").Prisma.BackupFindManyArgs
    ) => Promise<Partial<import("../generated/prisma/client").Backup>[]>
  >();
const mockBackupFindUnique = jest.fn<
  (args: import("../prisma").Prisma.BackupFindUniqueArgs) => Promise<
    | (Omit<Partial<import("../generated/prisma/client").Backup>, "backupPath"> & {
        backupPath?: string | null;
      })
    | null
  >
>();
const mockBackupDelete =
  jest.fn<
    (
      args: import("../prisma").Prisma.BackupDeleteArgs
    ) => Promise<Partial<import("../generated/prisma/client").Backup>>
  >();
const mockAdminSettingsFindFirst =
  jest.fn<
    (
      args: import("../prisma").Prisma.AdminSettingsFindFirstArgs
    ) => Promise<Partial<import("../generated/prisma/client").AdminSettings> | null>
  >();
const mockDeleteCloudBackup =
  jest.fn<typeof import("../services/cloudSyncService").deleteCloudBackup>();
jest.mock("../services/cloudSyncService", () => ({ deleteCloudBackup: mockDeleteCloudBackup }));

jest.mock("../db", () => ({
  prisma: {
    backup: {
      findMany: mockBackupFindMany,
      findUnique: mockBackupFindUnique,
      delete: mockBackupDelete,
    },
    adminSettings: {
      findFirst: mockAdminSettingsFindFirst,
    },
  },
}));

// Mock fs (imported as `import * as fs from 'fs'` in backupService)
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
  statSync: jest.fn(),
  createWriteStream: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock archiver to prevent native module issues (path-scurry) in test environment
jest.mock("archiver", () => jest.fn());

// Mock logger
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock database utility to avoid requiring real env vars at module load
jest.mock("../utils/database", () => ({
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
}));

// Import service after mocks are registered
import { listBackups, getBackup, deleteBackup, cleanupOldBackups } from "../services/backupService";
import * as fs from "fs";
import { AppError } from "../middleware/errorHandler";

const mockExistsSync = fs.existsSync as jest.Mock;
const mockRmSync = fs.rmSync as jest.Mock;

const MOCK_BACKUP = {
  id: "backup-1",
  type: "full",
  status: "completed",
  backupPath: "/data/backups/backup-1/backup.tar.gz",
  dbBackupPath: null,
  filesBackupPath: null,
  size: BigInt(1024),
  retentionDays: 30,
  startedAt: null,
  completedAt: new Date("2026-01-01T00:05:00Z"),
  errorMessage: null,
  errorCode: null,
  metadata: null,
  syncedToCloud: false,
  cloudSyncAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:05:00Z"),
};

describe("backupService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: directories/files do not exist (safe default)
    mockExistsSync.mockReturnValue(false);
  });

  // ─── listBackups ───────────────────────────────────────────────────────────

  describe("listBackups", () => {
    it("returns backups ordered by createdAt desc", async () => {
      const backups = [MOCK_BACKUP, { ...MOCK_BACKUP, id: "backup-2" }];
      mockBackupFindMany.mockResolvedValue(backups);

      const result = await listBackups();

      expect(result).toEqual(backups);
      expect(mockBackupFindMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns empty array when no backups exist", async () => {
      mockBackupFindMany.mockResolvedValue([]);

      const result = await listBackups();

      expect(result).toEqual([]);
    });
  });

  // ─── getBackup ─────────────────────────────────────────────────────────────

  describe("getBackup", () => {
    it("returns backup with fileExists: true when file exists on disk", async () => {
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);

      const result = await getBackup("backup-1");

      expect(result).toEqual({ ...MOCK_BACKUP, fileExists: true });
      expect(mockBackupFindUnique).toHaveBeenCalledWith({ where: { id: "backup-1" } });
      expect(mockExistsSync).toHaveBeenCalledWith(MOCK_BACKUP.backupPath);
    });

    it("returns backup with fileExists: false when file does not exist on disk", async () => {
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(false);

      const result = await getBackup("backup-1");

      expect(result).toEqual({ ...MOCK_BACKUP, fileExists: false });
    });

    it("returns fileExists: false when backupPath is null", async () => {
      const backupWithNullPath = { ...MOCK_BACKUP, backupPath: null };
      mockBackupFindUnique.mockResolvedValue(backupWithNullPath);

      const result = await getBackup("backup-1");

      expect(result.fileExists).toBe(false);
      // existsSync should not be called with null
      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it("throws 'Backup not found' when backup does not exist in DB", async () => {
      mockBackupFindUnique.mockResolvedValue(null);

      await expect(getBackup("nonexistent-id")).rejects.toThrow("Backup not found");
      // forgejo#77: the status travels with the error, so the route need not guess.
      await expect(getBackup("nonexistent-id")).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── deleteBackup ──────────────────────────────────────────────────────────

  describe("deleteBackup", () => {
    it("deletes backup directory and DB record when file exists", async () => {
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      // backupPath exists → existsSync returns true for both the file and the dir
      mockExistsSync.mockReturnValue(true);

      await deleteBackup("backup-1");

      // Should delete the parent directory of backupPath
      const expectedDir = "/data/backups/backup-1";
      expect(mockRmSync).toHaveBeenCalledWith(expectedDir, { recursive: true, force: true });
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "backup-1" } });
    });

    it("skips rmSync when backupPath file does not exist on disk", async () => {
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      // file does not exist → existsSync returns false
      mockExistsSync.mockReturnValue(false);

      await deleteBackup("backup-1");

      expect(mockRmSync).not.toHaveBeenCalled();
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "backup-1" } });
    });

    it("skips rmSync when backupPath is null", async () => {
      const backupNoPath = { ...MOCK_BACKUP, backupPath: null };
      mockBackupFindUnique.mockResolvedValue(backupNoPath);

      await deleteBackup("backup-1");

      expect(mockRmSync).not.toHaveBeenCalled();
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "backup-1" } });
    });

    it("skips directory rmSync when backup directory does not exist", async () => {
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      // backupPath itself exists but its parent dir check returns false
      mockExistsSync
        .mockReturnValueOnce(true) // backup.backupPath exists
        .mockReturnValueOnce(false); // backupDir does not exist

      await deleteBackup("backup-1");

      expect(mockRmSync).not.toHaveBeenCalled();
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "backup-1" } });
    });

    it("throws 'Backup not found' when backup does not exist in DB", async () => {
      mockBackupFindUnique.mockResolvedValue(null);

      await expect(deleteBackup("nonexistent-id")).rejects.toThrow("Backup not found");
      await expect(deleteBackup("nonexistent-id")).rejects.toMatchObject({ statusCode: 404 });
      expect(mockBackupDelete).not.toHaveBeenCalled();
    });
  });

  it("retains the local file and row when remote deletion fails", async () => {
    mockBackupFindUnique.mockResolvedValue({ ...MOCK_BACKUP, syncedToCloud: true });
    mockDeleteCloudBackup.mockRejectedValueOnce(new Error("offline"));
    await expect(deleteBackup("backup-1", true)).rejects.toThrow("offline");
    expect(mockRmSync).not.toHaveBeenCalled();
    expect(mockBackupDelete).not.toHaveBeenCalled();
  });

  it("never deletes a running backup", async () => {
    mockBackupFindUnique.mockResolvedValue({ ...MOCK_BACKUP, status: "running" });
    await expect(deleteBackup("backup-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(mockBackupDelete).not.toHaveBeenCalled();
  });

  // ─── cleanupOldBackups ─────────────────────────────────────────────────────

  describe("cleanupOldBackups", () => {
    it("deletes old completed backups and returns deleted count", async () => {
      const oldBackup1 = { ...MOCK_BACKUP, id: "old-1" };
      const oldBackup2 = { ...MOCK_BACKUP, id: "old-2" };
      mockBackupFindMany
        .mockResolvedValueOnce([oldBackup1, oldBackup2])
        .mockResolvedValueOnce([{ id: "latest", backupPath: "/latest" }]);
      // deleteBackup calls findUnique for each; return the corresponding backup
      mockBackupFindUnique.mockResolvedValueOnce(oldBackup1).mockResolvedValueOnce(oldBackup2);
      mockExistsSync.mockImplementation((p) => p === "/latest");

      const count = await cleanupOldBackups();

      expect(count).toBe(2);
      expect(mockBackupDelete).toHaveBeenCalledTimes(2);
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "old-1" } });
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "old-2" } });
    });

    it("retains the last full archive even when expired", async () => {
      mockBackupFindMany.mockResolvedValue([MOCK_BACKUP]);
      mockExistsSync.mockReturnValue(true);
      expect(await cleanupOldBackups()).toBe(0);
      expect(mockBackupDelete).not.toHaveBeenCalled();
    });

    it("does not prune anything without an available full archive", async () => {
      mockBackupFindMany.mockResolvedValue([MOCK_BACKUP]);
      mockExistsSync.mockReturnValue(false);
      expect(await cleanupOldBackups()).toBe(0);
      expect(mockBackupDelete).not.toHaveBeenCalled();
    });

    it("uses the configured retention and remote opt-in", async () => {
      mockAdminSettingsFindFirst.mockResolvedValue({
        backupRetentionDays: 4,
        backupCloudRetention: true,
      });
      const old = { ...MOCK_BACKUP, syncedToCloud: true };
      mockBackupFindMany
        .mockResolvedValueOnce([old])
        .mockResolvedValueOnce([{ id: "latest", backupPath: "/latest" }]);
      mockBackupFindUnique.mockResolvedValue(old);
      mockExistsSync.mockImplementation((p) => p === "/latest");
      expect(await cleanupOldBackups()).toBe(1);
      const filter = mockBackupFindMany.mock.calls[0][0].where?.createdAt;
      if (
        !filter ||
        typeof filter !== "object" ||
        !("lt" in filter) ||
        !(filter.lt instanceof Date)
      ) {
        throw new Error("Expected a dated backup retention cutoff");
      }
      const cutoff = filter.lt.getTime();
      expect(Math.abs(cutoff - (Date.now() - 4 * 86400000))).toBeLessThan(1000);
      expect(mockDeleteCloudBackup).toHaveBeenCalledWith(old);
    });

    // Uploads before 2026-10-12 recorded no target, so remote deletion refuses
    // them with REMOTE_TARGET_UNKNOWN. That refusal used to keep the LOCAL
    // archive too, so with remote retention on, retention never deleted any
    // older archive again.
    describe("with remote retention on", () => {
      const old = { ...MOCK_BACKUP, id: "old-1", syncedToCloud: true };

      beforeEach(() => {
        mockAdminSettingsFindFirst.mockResolvedValue({ backupCloudRetention: true });
        mockBackupFindMany
          .mockResolvedValueOnce([old])
          .mockResolvedValueOnce([{ id: "latest", backupPath: "/latest" }]);
        mockBackupFindUnique.mockResolvedValue(old);
        mockExistsSync.mockReturnValue(true);
      });

      it("deletes the local archive when the remote target is unknown, leaving the remote copy", async () => {
        mockDeleteCloudBackup.mockRejectedValueOnce(
          new AppError("Remote backup target is unknown or changed", 409, "REMOTE_TARGET_UNKNOWN")
        );

        expect(await cleanupOldBackups()).toBe(1);

        expect(mockRmSync).toHaveBeenCalledWith("/data/backups/backup-1", expect.anything());
        expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "old-1" } });
      });

      it("keeps the local archive when a known remote target fails to delete", async () => {
        mockDeleteCloudBackup.mockRejectedValueOnce(
          new AppError("WebDAV share did not answer as expected: offline", 502)
        );

        expect(await cleanupOldBackups()).toBe(0);

        expect(mockRmSync).not.toHaveBeenCalled();
        expect(mockBackupDelete).not.toHaveBeenCalled();
      });
    });

    it("still refuses an explicit remote delete whose target is unknown", async () => {
      mockBackupFindUnique.mockResolvedValue({ ...MOCK_BACKUP, syncedToCloud: true });
      mockDeleteCloudBackup.mockRejectedValueOnce(
        new AppError("Remote backup target is unknown or changed", 409, "REMOTE_TARGET_UNKNOWN")
      );

      await expect(deleteBackup("backup-1", true)).rejects.toMatchObject({ statusCode: 409 });

      expect(mockBackupDelete).not.toHaveBeenCalled();
    });

    it("returns 0 when no old backups exist", async () => {
      mockBackupFindMany.mockResolvedValue([]);

      const count = await cleanupOldBackups();

      expect(count).toBe(0);
      expect(mockBackupDelete).not.toHaveBeenCalled();
    });

    it("queries only completed backups older than retention cutoff", async () => {
      mockBackupFindMany.mockResolvedValue([]);

      await cleanupOldBackups();

      expect(mockBackupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "completed",
            createdAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        })
      );
    });

    it("continues deleting remaining backups if one deletion fails", async () => {
      const failingBackup = { ...MOCK_BACKUP, id: "failing-1" };
      const successBackup = { ...MOCK_BACKUP, id: "success-2" };
      mockBackupFindMany
        .mockResolvedValueOnce([failingBackup, successBackup])
        .mockResolvedValueOnce([{ id: "latest", backupPath: "/latest" }]);

      // First findUnique for failing backup returns null → deleteBackup throws
      mockBackupFindUnique
        .mockResolvedValueOnce(null) // failing-1: not found → throws
        .mockResolvedValueOnce(successBackup); // success-2: found → deletes
      mockExistsSync.mockImplementation((p) => p === "/latest");

      const count = await cleanupOldBackups();

      // Only the successful deletion is counted
      expect(count).toBe(1);
      expect(mockBackupDelete).toHaveBeenCalledTimes(1);
      expect(mockBackupDelete).toHaveBeenCalledWith({ where: { id: "success-2" } });
    });
  });
});

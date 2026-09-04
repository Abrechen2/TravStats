import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

// ─── Shared mocks ───────────────────────────────────────────────────────────

const mockBackupFindUnique = jest.fn();
const mockBackupUpdate = jest.fn();
// Empty AdminSettings row — getWebDAVSettings / getInstanceSettings fall
// through to the ENV fallback that the beforeEach in each describe sets.
const mockAdminFindFirst = jest.fn().mockResolvedValue({
  id: "test",
  webdavSyncEnabled: null,
  webdavUrl: null,
  webdavUsername: null,
  webdavPasswordEncrypted: null,
  webdavBackupPath: null,
});
const mockAdminCreate = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    backup: { findUnique: mockBackupFindUnique, update: mockBackupUpdate },
    adminSettings: {
      findFirst: mockAdminFindFirst,
      create: mockAdminCreate,
      update: jest.fn(),
    },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
jest.mock("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

const mockClient = {
  getDirectoryContents: jest.fn(),
  createDirectory: jest.fn(),
  putFileContents: jest.fn(),
  getFileContents: jest.fn(),
};
const mockCreateClient = jest.fn(() => mockClient);
jest.mock("webdav", () => ({
  createClient: mockCreateClient,
}));

const MOCK_BACKUP = {
  id: "backup-1",
  status: "completed",
  backupPath: "/data/backups/backup-1/archive.tar.gz",
  syncedToCloud: false,
  cloudSyncAt: null,
};

// ─── Helper: load module with WebDAV env configured ─────────────────────────

type CloudSyncModule = typeof import("../services/cloudSyncService");

async function loadModule(enabled: boolean): Promise<CloudSyncModule> {
  jest.resetModules();
  jest.clearAllMocks();

  if (enabled) {
    process.env.WEBDAV_SYNC_ENABLED = "true";
    process.env.WEBDAV_URL = "https://webdav.test";
    process.env.WEBDAV_USERNAME = "user";
    process.env.WEBDAV_PASSWORD = "pass";
    process.env.WEBDAV_BACKUP_PATH = "/TravStats/backups/";
  } else {
    process.env.WEBDAV_SYNC_ENABLED = "false";
    delete process.env.WEBDAV_URL;
    delete process.env.WEBDAV_USERNAME;
    delete process.env.WEBDAV_PASSWORD;
  }

  return import("../services/cloudSyncService");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("cloudSyncService", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("testConnection", () => {
    it("returns success=false when WEBDAV_SYNC_ENABLED is false", async () => {
      const { testConnection } = await loadModule(false);

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not enabled/i);
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("returns success=true when WebDAV directory listing succeeds", async () => {
      const { testConnection } = await loadModule(true);
      mockClient.getDirectoryContents.mockResolvedValue([]);

      const result = await testConnection();

      expect(result.success).toBe(true);
      expect(mockCreateClient).toHaveBeenCalledWith("https://webdav.test", {
        username: "user",
        password: "pass",
      });
    });

    it("returns success=false with error message when directory listing throws", async () => {
      const { testConnection } = await loadModule(true);
      mockClient.getDirectoryContents.mockRejectedValue(new Error("401 Unauthorized"));

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("401 Unauthorized");
    });
  });

  // forgejo#77 — every failure carries its HTTP status, so the routes above
  // pass it straight to errorHandler instead of guessing from the message.
  describe("failures carry their status", () => {
    it("answers 409 for a disabled or unconfigured WebDAV, on every entry point", async () => {
      const { listCloudBackups, downloadFromCloud, syncToCloud } = await loadModule(false);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);

      await expect(listCloudBackups()).rejects.toMatchObject({ statusCode: 409 });
      await expect(downloadFromCloud("x.tar.gz", "/tmp/x")).rejects.toMatchObject({ statusCode: 409 });
      await expect(syncToCloud("backup-1")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("answers 404 for an unknown backup even when sync is disabled — the missing id is the more specific fact", async () => {
      const { syncToCloud } = await loadModule(false);
      mockBackupFindUnique.mockResolvedValue(null);

      await expect(syncToCloud("nope")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("answers 400 for a backup that is not finished and 404 for one whose file is gone", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue({ ...MOCK_BACKUP, status: "running" });
      await expect(syncToCloud("backup-1")).rejects.toMatchObject({ statusCode: 400 });

      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(false);
      await expect(syncToCloud("backup-1")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("maps a 404 from the share to 404 and any other share failure to 502", async () => {
      const { downloadFromCloud } = await loadModule(true);

      mockClient.getFileContents.mockRejectedValue(
        Object.assign(new Error("Invalid response: 404 Not Found"), { status: 404 }),
      );
      await expect(downloadFromCloud("gone.tar.gz", "/tmp/gone")).rejects.toMatchObject({
        statusCode: 404,
      });

      mockClient.getFileContents.mockRejectedValue(
        Object.assign(new Error("Invalid response: 500"), { status: 500 }),
      );
      await expect(downloadFromCloud("x.tar.gz", "/tmp/x")).rejects.toMatchObject({ statusCode: 502 });

      mockClient.getFileContents.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(downloadFromCloud("x.tar.gz", "/tmp/x")).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  describe("syncToCloud", () => {
    it("throws when WebDAV sync is not enabled", async () => {
      const { syncToCloud } = await loadModule(false);
      // The backup is looked up first (forgejo#77) — give it one to find.
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);

      await expect(syncToCloud("backup-1")).rejects.toThrow(/not enabled/i);
    });

    it("throws 'Backup not found' when backup record is missing", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(null);

      await expect(syncToCloud("missing-id")).rejects.toThrow(/not found/i);
      expect(mockClient.putFileContents).not.toHaveBeenCalled();
    });

    it("throws when backup status is not 'completed'", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue({ ...MOCK_BACKUP, status: "running" });

      await expect(syncToCloud("backup-1")).rejects.toThrow(/not completed/i);
    });

    it("throws when backup file does not exist on disk", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(false);

      await expect(syncToCloud("backup-1")).rejects.toThrow(/file not found/i);
    });

    it("uploads file and updates backup record on success", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(Buffer.from("backup-contents"));
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockResolvedValue(true);
      mockBackupUpdate.mockResolvedValue(undefined);

      await syncToCloud("backup-1");

      expect(mockClient.putFileContents).toHaveBeenCalledTimes(1);
      const [remotePath] = mockClient.putFileContents.mock.calls[0];
      expect(remotePath).toMatch(/archive\.tar\.gz$/);

      expect(mockBackupUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "backup-1" },
          data: expect.objectContaining({
            syncedToCloud: true,
            cloudSyncAt: expect.any(Date),
          }),
        }),
      );
    });

    it("swallows createDirectory errors (directory may already exist)", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(Buffer.from("data"));
      mockClient.createDirectory.mockRejectedValue(new Error("405 Directory exists"));
      mockClient.putFileContents.mockResolvedValue(true);
      mockBackupUpdate.mockResolvedValue(undefined);

      await expect(syncToCloud("backup-1")).resolves.toBeUndefined();
      expect(mockClient.putFileContents).toHaveBeenCalled();
    });

    it("rethrows when upload itself fails", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(Buffer.from("data"));
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockRejectedValue(new Error("507 Insufficient Storage"));

      await expect(syncToCloud("backup-1")).rejects.toThrow(/Insufficient Storage/);
      expect(mockBackupUpdate).not.toHaveBeenCalled();
    });
  });

  describe("listCloudBackups", () => {
    it("throws when WebDAV sync is not enabled", async () => {
      const { listCloudBackups } = await loadModule(false);

      await expect(listCloudBackups()).rejects.toThrow(/not enabled/i);
    });

    it("returns only .tar.gz files from the backup directory", async () => {
      const { listCloudBackups } = await loadModule(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.getDirectoryContents.mockResolvedValue([
        { type: "file", basename: "backup-1.tar.gz", size: 1024, lastmod: "2026-01-01T00:00:00Z" },
        { type: "file", basename: "readme.txt", size: 200, lastmod: "2026-01-01T00:00:00Z" },
        { type: "directory", basename: "other", size: 0, lastmod: "2026-01-01T00:00:00Z" },
        { type: "file", basename: "backup-2.tar.gz", size: 2048, lastmod: "2026-02-01T00:00:00Z" },
      ]);

      const result = await listCloudBackups();

      expect(result).toHaveLength(2);
      expect(result.map((b) => b.name)).toEqual(["backup-1.tar.gz", "backup-2.tar.gz"]);
      expect(result[0].size).toBe(1024);
      expect(result[0].lastModified).toBeInstanceOf(Date);
    });

    it("handles wrapped { data: [...] } response shape", async () => {
      const { listCloudBackups } = await loadModule(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.getDirectoryContents.mockResolvedValue({
        data: [
          { type: "file", basename: "a.tar.gz", size: 5, lastmod: "2026-01-01T00:00:00Z" },
        ],
      });

      const result = await listCloudBackups();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("a.tar.gz");
    });

    it("rethrows on WebDAV listing failure", async () => {
      const { listCloudBackups } = await loadModule(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.getDirectoryContents.mockRejectedValue(new Error("503 Service Unavailable"));

      await expect(listCloudBackups()).rejects.toThrow(/503/);
    });
  });

  describe("downloadFromCloud", () => {
    it("throws when WebDAV sync is not enabled", async () => {
      const { downloadFromCloud } = await loadModule(false);

      await expect(downloadFromCloud("backup-1.tar.gz", "/tmp/out.tar.gz")).rejects.toThrow(
        /not enabled/i,
      );
    });

    it("writes downloaded content to the local path", async () => {
      const { downloadFromCloud } = await loadModule(true);
      mockClient.getFileContents.mockResolvedValue(Buffer.from("archive-bytes"));

      await downloadFromCloud("backup-1.tar.gz", "/tmp/out.tar.gz");

      expect(mockClient.getFileContents).toHaveBeenCalledWith(
        expect.stringContaining("backup-1.tar.gz"),
        { format: "binary" },
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith("/tmp/out.tar.gz", expect.any(Buffer));
    });

    it("rethrows when download fails", async () => {
      const { downloadFromCloud } = await loadModule(true);
      mockClient.getFileContents.mockRejectedValue(new Error("404 Not Found"));

      await expect(downloadFromCloud("missing.tar.gz", "/tmp/out.tar.gz")).rejects.toThrow(
        /404/,
      );
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});

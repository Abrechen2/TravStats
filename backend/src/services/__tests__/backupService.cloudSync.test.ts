import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * The wiring itself, pinned.
 *
 * This file exists because a test of `syncToCloudIfEnabled` alone would have
 * passed happily for the entire time the bug was live: the uploader worked,
 * it simply had no caller. `POST /backup/:id/sync` was the only route that
 * reached it, no button in the admin UI called that route, and neither
 * `createBackup` nor the nightly scheduler did either — so not one backup this
 * application ever took reached a WebDAV share, while the settings help text
 * promised "after each successful backup the archive is uploaded".
 *
 * So what is asserted here is the call, not the upload.
 */

const mockSyncToCloudIfEnabled = jest.fn<(id: string) => Promise<void>>();
jest.mock("../cloudSyncService", () => ({
  syncToCloudIfEnabled: mockSyncToCloudIfEnabled,
}));

const mockBackupUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
jest.mock("../../db", () => ({
  prisma: {
    backup: {
      create: jest.fn(),
      update: mockBackupUpdate,
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockRmSync = jest.fn();
jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  statSync: jest.fn(() => ({ size: 4096 })),
  rmSync: mockRmSync,
  // The archive step resolves on the write stream's "close" event.
  createWriteStream: jest.fn(() => ({
    on: (event: string, cb: () => void) => {
      if (event === "close") setImmediate(cb);
    },
  })),
}));

jest.mock("archiver", () =>
  jest.fn(() => ({
    pipe: jest.fn(),
    file: jest.fn(),
    append: jest.fn(),
    on: jest.fn(),
    finalize: jest.fn(),
  })),
);

const mockCreateDatabaseDump = jest.fn<() => Promise<void>>();
jest.mock("../backup/backupDatabase", () => ({
  createDatabaseDump: mockCreateDatabaseDump,
}));

const mockArchiveUploads = jest.fn<() => Promise<void>>();
jest.mock("../backup/backupFiles", () => ({
  archiveUploads: mockArchiveUploads,
  getMetadata: jest.fn(async () => ({ userCount: 1 })),
}));

jest.mock("../backup/backupRestore", () => ({
  restoreBackup: jest.fn(),
}));

const EXISTING_RECORD = {
  id: "backup-test-1",
  backupPath: "/data/backups/backup-test-1/backup-test-1.tar.gz",
  dbBackupPath: "/data/backups/backup-test-1/temp/database.sql",
  filesBackupPath: "/data/backups/backup-test-1/temp/uploads.tar.gz",
};

describe("createBackup hands the finished archive to the cloud target", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncToCloudIfEnabled.mockResolvedValue(undefined);
    mockBackupUpdate.mockResolvedValue(undefined);
    mockCreateDatabaseDump.mockResolvedValue(undefined);
    mockArchiveUploads.mockResolvedValue(undefined);
  });

  it("uploads the backup it just completed", async () => {
    const { createBackup } = await import("../backupService");

    const id = await createBackup({ type: "full", existingRecord: EXISTING_RECORD });

    expect(id).toBe("backup-test-1");
    expect(mockSyncToCloudIfEnabled).toHaveBeenCalledWith("backup-test-1");
  });

  it("uploads only AFTER the record says completed", async () => {
    const { createBackup } = await import("../backupService");

    await createBackup({ type: "full", existingRecord: EXISTING_RECORD });

    // An upload of a row still marked `running` would be refused by
    // syncToCloud's own status check (400) — so the order is the behaviour,
    // not a detail.
    const completedCall = mockBackupUpdate.mock.invocationCallOrder[0];
    const syncCall = mockSyncToCloudIfEnabled.mock.invocationCallOrder[0];
    expect(mockBackupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }),
    );
    expect(completedCall).toBeLessThan(syncCall);
  });

  it("does not upload a backup that failed", async () => {
    const { createBackup } = await import("../backupService");
    mockCreateDatabaseDump.mockRejectedValue(new Error("pg_dump: connection refused"));

    await expect(
      createBackup({ type: "full", existingRecord: EXISTING_RECORD }),
    ).rejects.toThrow(/connection refused/);

    expect(mockSyncToCloudIfEnabled).not.toHaveBeenCalled();
  });

  it("keeps the archive when the upload throws, instead of deleting it", async () => {
    // The hazard this guards: the catch inside createBackup marks the backup
    // failed and rmSyncs its directory. If the upload ran inside that try, a
    // full remote share would destroy a perfectly good local backup. The
    // upload therefore runs after it — proven here by making it throw, which
    // its own contract says it never does.
    const { createBackup } = await import("../backupService");
    mockSyncToCloudIfEnabled.mockRejectedValue(new Error("507 Insufficient Storage"));

    await expect(
      createBackup({ type: "full", existingRecord: EXISTING_RECORD }),
    ).rejects.toThrow(/Insufficient Storage/);

    // The temp subdirectory is swept on the happy path and that is fine; what
    // must survive is the backup directory holding the archive.
    expect(mockRmSync).not.toHaveBeenCalledWith(
      "/data/backups/backup-test-1",
      expect.anything(),
    );
    expect(mockBackupUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });
});

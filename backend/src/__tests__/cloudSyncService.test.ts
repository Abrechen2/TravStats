import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

// ─── Shared mocks ───────────────────────────────────────────────────────────

const mockBackupFindUnique =
  jest.fn<
    (
      args: import("../prisma").Prisma.BackupFindUniqueArgs
    ) => Promise<Partial<import("../generated/prisma/client").Backup> | null>
  >();
const mockBackupUpdate =
  jest.fn<
    (
      args: import("../prisma").Prisma.BackupUpdateArgs
    ) => Promise<Partial<import("../generated/prisma/client").Backup>>
  >();
// Empty AdminSettings row — getWebDAVSettings / getInstanceSettings fall
// through to the ENV fallback that the beforeEach in each describe sets.
const mockAdminFindFirst = jest
  .fn<() => Promise<Partial<import("../generated/prisma/client").AdminSettings>>>()
  .mockResolvedValue({});
const mockAdminCreate =
  jest.fn<
    (
      args: import("../prisma").Prisma.AdminSettingsCreateArgs
    ) => Promise<Partial<import("../generated/prisma/client").AdminSettings>>
  >();
jest.mock("../db", () => ({
  prisma: {
    backup: { findUnique: mockBackupFindUnique, update: mockBackupUpdate },
    adminSettings: {
      findFirst: mockAdminFindFirst,
      create: mockAdminCreate,
      update:
        jest.fn<
          (
            args: import("../prisma").Prisma.AdminSettingsUpdateArgs
          ) => Promise<Partial<import("../generated/prisma/client").AdminSettings>>
        >(),
    },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockExistsSync = jest.fn();
// Streams, not buffers (forgejo#354): the service must never read a whole
// archive. readFileSync/writeFileSync are deliberately absent from the mock, so
// a regression to buffering fails with "not a function".
// A real Readable: the service now hashes the archive before it uploads it.
const mockCreateReadStream = jest.fn((_p: string) =>
  (jest.requireActual("stream") as typeof import("stream")).Readable.from([
    Buffer.from("archive-bytes"),
  ])
);
const mockCreateWriteStream = jest.fn();
const mockStatSync = jest.fn((_p: string) => ({ size: 15 }));
const mockRenameSync = jest.fn();
const mockRmSync = jest.fn();
let downloadedChunks: Buffer[] = [];
jest.mock("fs", () => ({
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  createReadStream: mockCreateReadStream,
  createWriteStream: mockCreateWriteStream,
  renameSync: mockRenameSync,
  rmSync: mockRmSync,
}));

type DirectoryEntry = Pick<import("webdav").FileStat, "type" | "basename" | "size" | "lastmod">;
const mockClient = {
  deleteFile: jest.fn<(path: string) => Promise<void>>(),
  getDirectoryContents: jest.fn<() => Promise<DirectoryEntry[] | { data: DirectoryEntry[] }>>(),
  createDirectory: jest.fn<() => Promise<void>>(),
  putFileContents:
    jest.fn<(path: string, contents: Buffer, options?: object) => Promise<boolean>>(),
  getFileContents: jest.fn<() => Promise<Buffer>>(),
  createReadStream:
    jest.fn<
      (p: string, o?: { callback?: (r: { headers: Headers }) => void }) => import("stream").Readable
    >(),
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
      await expect(downloadFromCloud("x.tar.gz", "/tmp/x")).rejects.toMatchObject({
        statusCode: 409,
      });
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
      const { Readable, Writable } = await import("stream");
      mockCreateWriteStream.mockImplementation(() => new Writable({ write: (_c, _e, cb) => cb() }));
      const failWith = (err: Error) =>
        mockClient.createReadStream.mockReturnValue(
          new Readable({
            read() {
              this.destroy(err);
            },
          })
        );

      failWith(Object.assign(new Error("Invalid response: 404 Not Found"), { status: 404 }));
      await expect(downloadFromCloud("gone.tar.gz", "/tmp/gone")).rejects.toMatchObject({
        statusCode: 404,
      });

      failWith(Object.assign(new Error("Invalid response: 500"), { status: 500 }));
      await expect(downloadFromCloud("x.tar.gz", "/tmp/x")).rejects.toMatchObject({
        statusCode: 502,
      });

      failWith(new Error("ECONNREFUSED"));
      await expect(downloadFromCloud("x.tar.gz", "/tmp/x")).rejects.toMatchObject({
        statusCode: 502,
      });
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
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockResolvedValue(true);
      mockBackupUpdate.mockResolvedValue({});

      await syncToCloud("backup-1");

      // The archive, then the checksum file beside it.
      expect(mockClient.putFileContents).toHaveBeenCalledTimes(2);
      const [remotePath] = mockClient.putFileContents.mock.calls[0];
      expect(remotePath).toMatch(/archive\.tar\.gz$/);
      // forgejo#354: the archive goes up as a stream with its length, never as a Buffer
      const [, body, options] = mockClient.putFileContents.mock.calls[0] as unknown as [
        string,
        unknown,
        { contentLength: number },
      ];
      expect(Buffer.isBuffer(body)).toBe(false);
      expect(typeof (body as { pipe?: unknown }).pipe).toBe("function");
      expect(options.contentLength).toBe(15);
      expect((options as { headers?: Record<string, string> }).headers).toEqual({
        "Content-Length": "15",
      });

      expect(mockBackupUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "backup-1" },
          data: expect.objectContaining({
            syncedToCloud: true,
            cloudSyncAt: expect.any(Date),
          }),
        })
      );
    });

    it("swallows createDirectory errors (directory may already exist)", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockClient.createDirectory.mockRejectedValue(new Error("405 Directory exists"));
      mockClient.putFileContents.mockResolvedValue(true);
      mockBackupUpdate.mockResolvedValue({});

      await expect(syncToCloud("backup-1")).resolves.toBeUndefined();
      expect(mockClient.putFileContents).toHaveBeenCalled();
    });

    it("rethrows when upload itself fails", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockRejectedValue(new Error("507 Insufficient Storage"));

      await expect(syncToCloud("backup-1")).rejects.toThrow(/Insufficient Storage/);
      expect(mockBackupUpdate).not.toHaveBeenCalled();
    });

    it("clears a previous failure reason once an upload succeeds", async () => {
      const { syncToCloud } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue({
        ...MOCK_BACKUP,
        cloudSyncError: "507 Insufficient Storage",
      });
      mockExistsSync.mockReturnValue(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockResolvedValue(true);
      mockBackupUpdate.mockResolvedValue({});

      await syncToCloud("backup-1");

      // A red explanation next to a green tick is worse than no explanation.
      expect(mockBackupUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ syncedToCloud: true, cloudSyncError: null }),
        })
      );
    });
  });

  // The wrapper `createBackup` calls. Its whole job is to be safe to call
  // unconditionally: silent when nobody asked for WebDAV, loud in the row when
  // somebody did and it did not work, and never fatal to the backup itself.
  describe("syncToCloudIfEnabled", () => {
    it("does nothing at all when WebDAV sync is switched off", async () => {
      const { syncToCloudIfEnabled } = await loadModule(false);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);

      await expect(syncToCloudIfEnabled("backup-1")).resolves.toBeUndefined();

      // Not an upload, and — the point — not an error written to the row
      // either. Most instances never configure WebDAV; for them this is not
      // a failure, it is a feature they did not switch on.
      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockBackupUpdate).not.toHaveBeenCalled();
    });

    it("uploads when it is switched on", async () => {
      const { syncToCloudIfEnabled } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockResolvedValue(true);
      mockBackupUpdate.mockResolvedValue({});

      await syncToCloudIfEnabled("backup-1");

      expect(mockClient.putFileContents).toHaveBeenCalledTimes(2);
    });

    it("records why a failed upload failed, and does not throw", async () => {
      const { syncToCloudIfEnabled } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockRejectedValue(new Error("507 Insufficient Storage"));
      mockBackupUpdate.mockResolvedValue({});

      // Not throwing is the contract: the archive is on local disk and is a
      // real backup. An upload that fails afterwards must not turn a good
      // backup into a failed one.
      await expect(syncToCloudIfEnabled("backup-1")).resolves.toBeUndefined();

      expect(mockBackupUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "backup-1" },
          data: expect.objectContaining({
            cloudSyncError: expect.stringContaining("Insufficient Storage"),
          }),
        })
      );
      // The status is untouched — no `status: 'failed'` anywhere in that call.
      const [{ data }] = mockBackupUpdate.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data).not.toHaveProperty("status");
    });

    it("records 'not configured' when the box is ticked but a field is empty", async () => {
      // Deliberately NOT treated as "switched off": someone who enabled sync
      // and left the URL blank meant to sync, and this sentence beside their
      // backup is what tells them why it did not happen.
      const { syncToCloudIfEnabled } = await loadModule(false);
      process.env.WEBDAV_SYNC_ENABLED = "true";
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockBackupUpdate.mockResolvedValue({});

      await expect(syncToCloudIfEnabled("backup-1")).resolves.toBeUndefined();

      expect(mockBackupUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cloudSyncError: expect.stringMatching(/not configured/i),
          }),
        })
      );
    });

    it("truncates a share that answers with a whole document", async () => {
      const { syncToCloudIfEnabled } = await loadModule(true);
      mockBackupFindUnique.mockResolvedValue(MOCK_BACKUP);
      mockExistsSync.mockReturnValue(true);
      mockClient.createDirectory.mockResolvedValue(undefined);
      mockClient.putFileContents.mockRejectedValue(new Error("x".repeat(5000)));
      mockBackupUpdate.mockResolvedValue({});

      await syncToCloudIfEnabled("backup-1");

      const [{ data }] = mockBackupUpdate.mock.calls[0] as [{ data: { cloudSyncError: string } }];
      expect(data.cloudSyncError.length).toBeLessThanOrEqual(500);
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
        data: [{ type: "file", basename: "a.tar.gz", size: 5, lastmod: "2026-01-01T00:00:00Z" }],
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
        /not enabled/i
      );
    });

    it("streams the download into a side file and renames it on success (forgejo#354)", async () => {
      const { Readable, Writable } = await import("stream");
      const { downloadFromCloud } = await loadModule(true);
      downloadedChunks = [];
      mockClient.createReadStream.mockReturnValue(Readable.from([Buffer.from("archive-bytes")]));
      mockCreateWriteStream.mockImplementation(
        () =>
          new Writable({
            write(chunk: Buffer, _enc, cb) {
              downloadedChunks.push(chunk);
              cb();
            },
          })
      );

      await downloadFromCloud("backup-1.tar.gz", "/tmp/out.tar.gz");

      expect(mockClient.createReadStream).toHaveBeenCalledWith(
        expect.stringContaining("backup-1.tar.gz"),
        expect.anything()
      );
      // Only the small checksum file is read whole, never the archive.
      expect(mockClient.getFileContents).not.toHaveBeenCalledWith(
        expect.stringMatching(/backup-1\.tar\.gz$/),
        expect.anything()
      );
      expect(Buffer.concat(downloadedChunks).toString()).toBe("archive-bytes");
      expect(mockRenameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/tmp\/out\.tar\.gz\.[0-9a-f]+\.part$/),
        "/tmp/out.tar.gz"
      );
    });

    it("refuses a body shorter than its Content-Length instead of renaming it into an archive (webdav-download-truncation)", async () => {
      const { Readable, Writable } = await import("stream");
      const { downloadFromCloud } = await loadModule(true);
      mockRenameSync.mockClear();
      mockRmSync.mockClear();
      mockClient.createReadStream.mockImplementation((_p, options) => {
        options?.callback?.({ headers: new Headers({ "content-length": "100" }) });
        return Readable.from([Buffer.from("only-13-bytes")]);
      });
      mockCreateWriteStream.mockImplementation(() => new Writable({ write: (_c, _e, cb) => cb() }));

      await expect(downloadFromCloud("backup-1.tar.gz", "/tmp/out.tar.gz")).rejects.toMatchObject({
        statusCode: 502,
        code: "WEBDAV_DOWNLOAD_TRUNCATED",
      });
      expect(mockRenameSync).not.toHaveBeenCalled();
      expect(mockRmSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.part$/),
        expect.objectContaining({ force: true })
      );
    });

    it("renames a body whose length matches its Content-Length", async () => {
      const { Readable, Writable } = await import("stream");
      const { downloadFromCloud } = await loadModule(true);
      mockRenameSync.mockClear();
      mockClient.createReadStream.mockImplementation((_p, options) => {
        options?.callback?.({ headers: new Headers({ "content-length": "13" }) });
        return Readable.from([Buffer.from("archive-bytes")]);
      });
      mockCreateWriteStream.mockImplementation(() => new Writable({ write: (_c, _e, cb) => cb() }));
      await downloadFromCloud("backup-1.tar.gz", "/tmp/out.tar.gz");
      expect(mockRenameSync).toHaveBeenCalled();
    });

    it("rethrows a download that dies mid-stream and leaves no partial archive behind (forgejo#354)", async () => {
      const { Readable, Writable } = await import("stream");
      const { downloadFromCloud } = await loadModule(true);
      mockClient.createReadStream.mockReturnValue(
        new Readable({
          read() {
            this.push(Buffer.from("half"));
            this.destroy(new Error("connection reset"));
          },
        })
      );
      mockCreateWriteStream.mockImplementation(() => new Writable({ write: (_c, _e, cb) => cb() }));

      await expect(downloadFromCloud("x.tar.gz", "/tmp/out.tar.gz")).rejects.toThrow(
        /connection reset|upstream/i
      );
      expect(mockRenameSync).not.toHaveBeenCalled();
      expect(mockRmSync).toHaveBeenCalledWith(expect.stringMatching(/\.part$/), { force: true });
    });
  });
});

describe("remote backup deletion identity", () => {
  it("records the target at upload and deletes exactly that object; missing remote is idempotent", async () => {
    const { syncToCloud, deleteCloudBackup } = await loadModule(true);
    mockBackupFindUnique.mockResolvedValue({
      id: "b",
      status: "completed",
      backupPath: "/tmp/backup-2026.tar.gz",
    });
    mockExistsSync.mockReturnValue(true);
    mockClient.putFileContents.mockResolvedValue(true);
    await syncToCloud("b");
    const written = mockBackupUpdate.mock.calls.at(-1)?.[0].data;
    if (
      !written ||
      typeof written.cloudTarget !== "string" ||
      typeof written.cloudPath !== "string"
    ) {
      throw new Error("Expected the uploaded backup identity to be persisted");
    }
    expect(written.cloudTarget).toMatch(/^[a-f0-9]{64}$/);
    mockClient.deleteFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ status: 404 });
    const backup = { id: "b", cloudTarget: written.cloudTarget, cloudPath: written.cloudPath };
    await deleteCloudBackup(backup);
    await deleteCloudBackup(backup);
    // The archive, and the checksum file that travels with it.
    expect(mockClient.deleteFile).toHaveBeenCalledWith("/TravStats/backups/backup-2026.tar.gz");
    expect(mockClient.deleteFile).toHaveBeenCalledWith(
      "/TravStats/backups/backup-2026.tar.gz.sha256"
    );
  });

  it("refuses legacy or changed targets and retains an actionable error", async () => {
    const { deleteCloudBackup } = await loadModule(true);
    mockClient.deleteFile.mockClear();
    // The code is what lets retention tell "cannot name the object" from a
    // share that failed, and delete the local archive only for the former.
    await expect(deleteCloudBackup({ id: "b" })).rejects.toMatchObject({
      statusCode: 409,
      code: "REMOTE_TARGET_UNKNOWN",
    });
    await expect(
      deleteCloudBackup({
        id: "b",
        cloudTarget: "different",
        cloudPath: "/TravStats/backups/backup-2026.tar.gz",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockClient.deleteFile).not.toHaveBeenCalled();
    expect(mockBackupUpdate).toHaveBeenLastCalledWith({
      where: { id: "b" },
      data: { cloudDeleteError: "REMOTE_TARGET_UNKNOWN" },
    });
  });
});

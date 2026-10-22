import { describe, it, expect, jest, beforeEach, afterAll } from "@jest/globals";
import { gunzipSync } from "zlib";

/**
 * One run of an account's WebDAV sync against a stand-in share: what goes up,
 * what the clean-up may delete, and that every failure is recorded with its
 * own reason instead of passing as a success (forgejo#321).
 */

type Fn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const share = {
  createDirectory: jest.fn() as Fn,
  putFileContents: jest.fn() as Fn,
  getDirectoryContents: jest.fn() as Fn,
  deleteFile: jest.fn() as Fn,
};
const createClient = jest.fn((..._args: unknown[]) => share);
jest.mock("webdav", () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { runWebdavSync, EXPORT_FILE_PATTERN, exportFileName } from "../runSync";
import { WebdavSyncError } from "../errors";
import { dueWebdavSyncs } from "../../../jobs/webdavSyncScheduler";

const userIds: string[] = [];

async function makeUser(isAdmin = false, sync: Record<string, unknown> = {}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `webdav-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "x",
      isAdmin,
      isActive: true,
      trips: { create: [{ name: "Exported trip" }] },
    },
  });
  userIds.push(user.id);
  await prisma.userWebdavSync.create({
    data: {
      userId: user.id,
      enabled: true,
      url: "https://cloud.example.com/remote.php/dav/files/me",
      username: "me",
      passwordEncrypted: encryptApiKey("s3cret"),
      keepVersions: 2,
      ...sync,
    },
  });
  return user.id;
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof WebdavSyncError ? error.code : "other";
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  share.createDirectory.mockResolvedValue(undefined);
  share.putFileContents.mockResolvedValue(true);
  share.getDirectoryContents.mockResolvedValue([]);
  share.deleteFile.mockResolvedValue(undefined);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("runWebdavSync", () => {
  it("uploads the account's own export, gzipped, under a new name, with the stored password", async () => {
    const userId = await makeUser();
    const result = await runWebdavSync(userId);

    expect(result.status).toBe("ok");
    expect(createClient).toHaveBeenCalledWith(
      "https://cloud.example.com/remote.php/dav/files/me",
      expect.objectContaining({ username: "me", password: "s3cret" })
    );
    const [remote, body, options] = share.putFileContents.mock.calls[0] as [
      string,
      Buffer,
      { overwrite: boolean },
    ];
    expect(remote).toMatch(/^\/TravStats\/travstats-export-\d{8}T\d{6}Z\.json\.gz$/);
    expect(options.overwrite).toBe(false);
    const json = JSON.parse(gunzipSync(body).toString("utf8")) as {
      format: string;
      user: { id: string; trips: Array<{ name: string }>; passwordHash?: string };
    };
    expect(json.format).toBe("travstats-account-export/1");
    expect(json.user.id).toBe(userId);
    expect(json.user.trips.map((t) => t.name)).toEqual(["Exported trip"]);
    // Credential material stays out, exactly as in the admin export.
    expect(json.user.passwordHash).toBeUndefined();

    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("ok");
    expect(row.lastErrorCode).toBeNull();
    expect(row.lastSuccessAt).not.toBeNull();
    expect(row.lastSizeBytes).toBe(body.length);
  });

  it("keeps the newest versions and deletes only OUR older files", async () => {
    const userId = await makeUser();
    share.getDirectoryContents.mockResolvedValue([
      { type: "file", basename: "travstats-export-20261001T051500Z.json.gz" },
      { type: "file", basename: "travstats-export-20261002T051500Z.json.gz" },
      { type: "file", basename: "travstats-export-20261003T051500Z.json.gz" },
      { type: "file", basename: "holiday-photos.zip" },
      { type: "directory", basename: "travstats-export-20260101T000000Z.json.gz" },
    ]);
    const result = await runWebdavSync(userId);
    expect(result.deleted).toBe(1);
    expect(share.deleteFile).toHaveBeenCalledTimes(1);
    expect(share.deleteFile.mock.calls[0][0]).toBe(
      "/TravStats/travstats-export-20261001T051500Z.json.gz"
    );
  });

  it("records a refused password as `auth` and fails the run — never a success", async () => {
    const userId = await makeUser();
    share.createDirectory.mockRejectedValue(Object.assign(new Error("401"), { status: 401 }));
    expect(await codeOf(runWebdavSync(userId))).toBe("auth");
    expect(share.putFileContents).not.toHaveBeenCalled();
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("failed");
    expect(row.lastErrorCode).toBe("auth");
    expect(row.lastSuccessAt).toBeNull();
    expect(row.lastAttemptAt).not.toBeNull();
  });

  it("records a full share as `quota`", async () => {
    const userId = await makeUser();
    share.putFileContents.mockRejectedValue(Object.assign(new Error("507"), { status: 507 }));
    expect(await codeOf(runWebdavSync(userId))).toBe("quota");
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastErrorCode).toBe("quota");
  });

  it("calls a failed clean-up `partial` with its reason: the export is up, the old ones are not gone", async () => {
    const userId = await makeUser();
    share.getDirectoryContents.mockRejectedValue(
      Object.assign(new Error("x"), { code: "ETIMEDOUT" })
    );
    const result = await runWebdavSync(userId);
    expect(result).toMatchObject({ status: "partial", errorCode: "timeout" });
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("partial");
    expect(row.lastErrorCode).toBe("timeout");
  });

  it("refuses a LAN share stored by an account that is no longer an admin", async () => {
    const userId = await makeUser(false, { url: "http://192.168.178.202/dav" });
    expect(await codeOf(runWebdavSync(userId))).toBe("blockedTarget");
    expect(createClient).not.toHaveBeenCalled();
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastErrorCode).toBe("blockedTarget");
  });

  it("lets an admin's sync reach a LAN share", async () => {
    const userId = await makeUser(true, { url: "http://192.168.178.202/dav" });
    expect((await runWebdavSync(userId)).status).toBe("ok");
  });

  it("answers `notConfigured` for a switched-off sync and uploads nothing", async () => {
    const userId = await makeUser(false, { enabled: false });
    expect(await codeOf(runWebdavSync(userId))).toBe("notConfigured");
    expect(share.putFileContents).not.toHaveBeenCalled();
  });

  it("refuses a second run of the same account while one is going", async () => {
    const userId = await makeUser();
    let release: () => void = () => undefined;
    share.putFileContents.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(true)))
    );
    const first = runWebdavSync(userId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await codeOf(runWebdavSync(userId))).toBe("alreadyRunning");
    release();
    await expect(first).resolves.toMatchObject({ status: "ok" });
  });
});

describe("export file names", () => {
  it("are sortable and match the retention pattern", () => {
    const name = exportFileName(new Date("2026-10-22T05:15:07.123Z"));
    expect(name).toBe("travstats-export-20261022T051507Z.json.gz");
    expect(EXPORT_FILE_PATTERN.test(name)).toBe(true);
  });
});

describe("dueWebdavSyncs", () => {
  it("is due when never tried or after its interval; a failing share waits for its schedule", async () => {
    const now = new Date("2026-10-22T05:15:00Z");
    const never = await makeUser();
    const dailyRecent = await makeUser(false, { lastAttemptAt: new Date("2026-10-22T01:00:00Z") });
    const dailyOld = await makeUser(false, { lastAttemptAt: new Date("2026-10-21T05:15:00Z") });
    const weeklyRecent = await makeUser(false, {
      schedule: "weekly",
      lastAttemptAt: new Date("2026-10-19T05:15:00Z"),
    });
    const off = await makeUser(false, { enabled: false });
    const due = await dueWebdavSyncs(now);
    expect(due).toEqual(expect.arrayContaining([never, dailyOld]));
    expect(due).not.toEqual(expect.arrayContaining([dailyRecent]));
    expect(due).not.toEqual(expect.arrayContaining([weeklyRecent]));
    expect(due).not.toEqual(expect.arrayContaining([off]));
  });
});

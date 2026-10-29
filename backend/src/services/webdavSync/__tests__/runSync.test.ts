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
  deleteFile: jest.fn() as Fn,
  customRequest: jest.fn() as Fn,
};
const createClient = jest.fn((..._args: unknown[]) => share);
jest.mock("webdav", () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { runWebdavSync, isWebdavSyncRunning, exportOwnerTag } from "../runSync";
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

/** A PROPFIND Depth 1 answer naming these files (and the folder itself). */
function multistatus(names: string[], folder = "/TravStats/"): string {
  const entry = (href: string, collection: boolean): string =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${
      collection ? "<d:collection/>" : ""
    }</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${[
    entry(folder, true),
    ...names.map((n) => entry(`${folder}${n}`, false)),
  ].join("")}</d:multistatus>`;
}

/**
 * A share that remembers what was put on it and lists it back.
 */
function statefulShare(initial: string[] = []): Set<string> {
  const files = new Set(initial);
  share.putFileContents.mockImplementation(async (...args: unknown[]) => {
    files.add(String(args[0]).split("/").pop() as string);
    return true;
  });
  share.deleteFile.mockImplementation(async (...args: unknown[]) => {
    files.delete(String(args[0]).split("/").pop() as string);
  });
  share.customRequest.mockImplementation(
    async () => new Response(multistatus([...files]), { status: 207 })
  );
  return files;
}

/** A name this account's own upload at `stamp` would have carried. */
function ownName(userId: string, stamp: string): string {
  return `travstats-export-${exportOwnerTag(userId)}-${stamp}.json.gz`;
}

/** `name` with its timestamp replaced: an older export of the same owner. */
function olderSibling(name: string, stamp: string): string {
  return name.replace(/\d{8}T\d{6}Z/, stamp);
}

beforeEach(() => {
  jest.clearAllMocks();
  share.createDirectory.mockResolvedValue(undefined);
  share.putFileContents.mockResolvedValue(true);
  share.deleteFile.mockResolvedValue(undefined);
  share.customRequest.mockImplementation(
    async () => new Response(multistatus([]), { status: 207 })
  );
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("runWebdavSync", () => {
  it("uploads the account's own export, gzipped, under a new name, with the stored password", async () => {
    const userId = await makeUser();
    // The upload is a stream with a length (forgejo#355), consumed while the
    // share "receives" it - the temp file is gone once the run returns.
    let received: Buffer = Buffer.alloc(0);
    let bodyWasBuffer = true;
    share.putFileContents.mockImplementation(async (...args: unknown[]) => {
      bodyWasBuffer = Buffer.isBuffer(args[1]);
      const chunks: Buffer[] = [];
      for await (const c of args[1] as AsyncIterable<Buffer>) chunks.push(c);
      received = Buffer.concat(chunks);
      return true;
    });
    const result = await runWebdavSync(userId);

    expect(result.status).toBe("ok");
    expect(bodyWasBuffer).toBe(false);
    expect(createClient).toHaveBeenCalledWith(
      "https://cloud.example.com/remote.php/dav/files/me",
      expect.objectContaining({ username: "me", password: "s3cret" })
    );
    const body = received;
    const [remote, , options] = share.putFileContents.mock.calls[0] as [
      string,
      unknown,
      { overwrite: boolean; contentLength: number; headers: Record<string, string> },
    ];
    expect(options.contentLength).toBe(body.length);
    expect(options.headers["Content-Length"]).toBe(String(body.length));
    expect(remote).toMatch(/^\/TravStats\/travstats-export-[0-9a-f]{12}-\d{8}T\d{6}Z\.json\.gz$/);
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

  it("marks the sync failed when reading the history dies mid-stream, and uploads nothing (forgejo#355)", async () => {
    const userId = await makeUser();
    const spy = jest
      .spyOn(prisma.travTrackPoint, "findMany")
      .mockRejectedValueOnce(new Error("db went away"));
    try {
      await expect(runWebdavSync(userId)).rejects.toBeDefined();
    } finally {
      spy.mockRestore();
    }
    expect(share.putFileContents).not.toHaveBeenCalled();
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("failed");
    expect(row.lastSuccessAt).toBeNull();
  });

  it("keeps the newest recorded exports, deletes the older recorded ones and nothing else", async () => {
    const userId = await makeUser();
    const recorded = ["20261003T051500Z", "20261002T051500Z", "20261001T051500Z"].map((stamp) =>
      ownName(userId, stamp)
    );
    await prisma.userWebdavSync.update({ where: { userId }, data: { uploadedFiles: recorded } });
    const files = statefulShare(["holiday-photos.zip", ...recorded]);
    const result = await runWebdavSync(userId);
    // keepVersions 2: this run's upload and 3 October stay; 1 and 2 October go.
    expect(result).toMatchObject({ status: "ok", deleted: 2 });
    expect([...files].sort()).toEqual(
      ["holiday-photos.zip", recorded[0], result.fileName as string].sort()
    );
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.uploadedFiles).toEqual([result.fileName, recorded[0]]);
  });

  it("drops a recorded export the share no longer has from the record without deleting it", async () => {
    const userId = await makeUser();
    const gone = ownName(userId, "20261001T051500Z");
    await prisma.userWebdavSync.update({ where: { userId }, data: { uploadedFiles: [gone] } });
    statefulShare();
    const result = await runWebdavSync(userId);
    expect(share.deleteFile).not.toHaveBeenCalled();
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.uploadedFiles).toEqual([result.fileName]);
  });

  it("never deletes another account's exports in a folder both sync into", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const files = statefulShare();
    const bobsName = (await runWebdavSync(bob)).fileName as string;
    const bobsOlder = ["20261001T051500Z", "20261002T051500Z", "20261003T051500Z"].map((stamp) =>
      olderSibling(bobsName, stamp)
    );
    for (const name of bobsOlder) files.add(name);

    const alicesName = (await runWebdavSync(alice)).fileName as string;
    expect(alicesName).not.toBe(bobsName);
    // Alice keeps two versions; Bob's four exports are not hers to count.
    for (const name of [bobsName, ...bobsOlder]) expect(files.has(name)).toBe(true);
    expect(files.has(alicesName)).toBe(true);
    // The name does not carry the account's id or user name in clear.
    expect(alicesName).not.toContain(alice);
  });

  it("never deletes the newest export when the listing names it more than once", async () => {
    const userId = await makeUser();
    const files = statefulShare();
    // A share (or a proxy) that repeats an entry: the one export there is
    // listed three times.
    share.customRequest.mockImplementation(async () => {
      const [only] = [...files];
      return new Response(multistatus([only, only, only]), { status: 207 });
    });
    const result = await runWebdavSync(userId);
    expect(result.status).toBe("ok");
    expect(share.deleteFile).not.toHaveBeenCalled();
    expect(files.has(result.fileName as string)).toBe(true);
  });

  it("never deletes an export with its own tag that this account did not record uploading", async () => {
    // A restored or cloned instance with the same database and key computes
    // the same tag; what IT uploaded must survive this instance's clean-up.
    const userId = await makeUser();
    const files = statefulShare();
    const first = (await runWebdavSync(userId)).fileName as string;
    const clones = ["20271001T051500Z", "20271002T051500Z", "20271003T051500Z"].map((stamp) =>
      olderSibling(first, stamp)
    );
    for (const name of clones) files.add(name);
    jest.clearAllMocks();
    await runWebdavSync(userId);
    for (const name of clones) expect(files.has(name)).toBe(true);
    expect(share.deleteFile.mock.calls.map((c) => String(c[0]))).toEqual(
      expect.not.arrayContaining(clones.map((n) => `/TravStats/${n}`))
    );
  });

  it("deletes at most a bounded number of old exports per run and calls the rest `partial`", async () => {
    const userId = await makeUser();
    const recorded = Array.from({ length: 60 }, (_, i) =>
      ownName(
        userId,
        `202608${String((i % 28) + 1).padStart(2, "0")}T${String(i).padStart(2, "0")}0000Z`
      )
    )
      .sort()
      .reverse();
    await prisma.userWebdavSync.update({ where: { userId }, data: { uploadedFiles: recorded } });
    const files = statefulShare(recorded);
    const result = await runWebdavSync(userId);
    expect(share.deleteFile).toHaveBeenCalledTimes(20);
    expect(result).toMatchObject({
      status: "partial",
      errorCode: "cleanupIncomplete",
      deleted: 20,
    });
    // The oldest went first; the newest recorded one is still there.
    expect(files.has(recorded[0])).toBe(true);
    expect(files.has(recorded[59])).toBe(false);
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.uploadedFiles).toHaveLength(41);
  });

  it("refuses an oversized listing instead of reading it all, and deletes nothing", async () => {
    const userId = await makeUser();
    // Five recorded old exports, then megabytes of padding: read whole, the
    // listing would have four of them deleted.
    const own = ["20261005", "20261004", "20261003", "20261002", "20261001"].map((day) =>
      ownName(userId, `${day}T051500Z`)
    );
    await prisma.userWebdavSync.update({ where: { userId }, data: { uploadedFiles: own } });
    const padded = multistatus(own).replace(
      "</d:multistatus>",
      `${" ".repeat(3 * 1024 * 1024)}</d:multistatus>`
    );
    share.customRequest.mockImplementation(async () => new Response(padded, { status: 207 }));
    const result = await runWebdavSync(userId);
    expect(result).toMatchObject({ status: "partial", errorCode: "cleanupIncomplete" });
    expect(share.deleteFile).not.toHaveBeenCalled();
    // Nothing could be confirmed, so nothing was forgotten either.
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.uploadedFiles).toEqual([result.fileName, ...own]);
  });

  it("does not read an entry hidden in a comment or CDATA as a file", async () => {
    const userId = await makeUser();
    const old = ownName(userId, "20261001T051500Z");
    await prisma.userWebdavSync.update({ where: { userId }, data: { uploadedFiles: [old] } });
    // The share no longer has `old`; only a comment and a CDATA block name it.
    const hidden = `<d:response><d:href>/TravStats/${old}</d:href></d:response>`;
    share.customRequest.mockImplementation(
      async () =>
        new Response(
          multistatus([]).replace(
            "</d:multistatus>",
            `<!-- ${hidden} --><x><![CDATA[${hidden}]]></x></d:multistatus>`
          ),
          { status: 207 }
        )
    );
    const result = await runWebdavSync(userId);
    expect(share.deleteFile).not.toHaveBeenCalled();
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.uploadedFiles).toEqual([result.fileName]);
  });

  it("ends a run whose folder check hangs as a `timeout` failure and releases the account", async () => {
    const userId = await makeUser();
    const signals: AbortSignal[] = [];
    // A share that never answers and ignores cancellation — the worst case.
    share.createDirectory.mockImplementation((...args: unknown[]) => {
      const options = args[1] as { signal?: AbortSignal } | undefined;
      if (options?.signal) signals.push(options.signal);
      return new Promise(() => undefined);
    });
    const run = runWebdavSync as (id: string, o?: { deadlineMs?: number }) => Promise<unknown>;
    expect(await codeOf(run(userId, { deadlineMs: 300 }))).toBe("timeout");
    expect(isWebdavSyncRunning(userId)).toBe(false);
    expect(share.putFileContents).not.toHaveBeenCalled();
    // The folder check was cancelled, not merely abandoned.
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    for (const call of share.createDirectory.mock.calls) {
      expect((call[1] as { recursive?: boolean }).recursive).not.toBe(true);
    }
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("failed");
    expect(row.lastErrorCode).toBe("timeout");
  });

  it("keeps an upload that is in as a success when the deadline hits during the clean-up", async () => {
    const userId = await makeUser();
    // The upload is in; the listing never answers and ignores cancellation.
    share.customRequest.mockImplementation(() => new Promise(() => undefined));
    const run = runWebdavSync as (
      id: string,
      o?: { deadlineMs?: number }
    ) => Promise<{ status: string; errorCode: string | null; fileName: string | null }>;
    const result = await run(userId, { deadlineMs: 300 });
    expect(result).toMatchObject({ status: "partial", errorCode: "timeout" });
    expect(result.fileName).toMatch(/^travstats-export-/);
    expect(isWebdavSyncRunning(userId)).toBe(false);
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("partial");
    expect(row.lastErrorCode).toBe("timeout");
    expect(row.lastFileName).toBe(result.fileName);
    expect(row.lastSuccessAt).not.toBeNull();
    expect(row.uploadedFiles).toEqual([result.fileName]);
  });

  it("frees the account at the deadline even when reading its settings hangs", async () => {
    const userId = await makeUser();
    const spy = jest
      .spyOn(prisma.userWebdavSync, "findUnique")
      .mockImplementation(() => new Promise(() => undefined) as never);
    try {
      const run = runWebdavSync as (id: string, o?: { deadlineMs?: number }) => Promise<unknown>;
      const started = Date.now();
      expect(await codeOf(run(userId, { deadlineMs: 300 }))).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(5000);
      expect(isWebdavSyncRunning(userId)).toBe(false);
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastErrorCode).toBe("timeout");
  });

  it("lets no late write of a timed-out run overwrite the next run's result", async () => {
    const userId = await makeUser();
    statefulShare();
    // While `slow` is on, every write to the sync row lands 800 ms late.
    let slow = true;
    const delayed: Array<Promise<unknown>> = [];
    const wrap = <K extends "update" | "updateMany">(method: K) => {
      const original = prisma.userWebdavSync[method].bind(prisma.userWebdavSync) as (
        args: unknown
      ) => Promise<unknown>;
      return jest.spyOn(prisma.userWebdavSync, method).mockImplementation(((args: unknown) => {
        if (!slow) return original(args);
        const late = new Promise((resolve) => setTimeout(resolve, 800)).then(() => original(args));
        delayed.push(late.catch(() => undefined));
        return late;
      }) as never);
    };
    const spies = [wrap("update"), wrap("updateMany")];
    try {
      const run = runWebdavSync as (id: string, o?: { deadlineMs?: number }) => Promise<unknown>;
      const first = codeOf(run(userId, { deadlineMs: 300 }));
      const started = Date.now();
      while (isWebdavSyncRunning(userId) && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(isWebdavSyncRunning(userId)).toBe(false);
      expect(Date.now() - started).toBeLessThan(700);
      slow = false;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await runWebdavSync(userId);
      expect(second.status).toBe("ok");
      expect(await first).toBe("timeout");
      await Promise.all(delayed);
      const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
      expect(row).toMatchObject({ lastStatus: "ok", lastFileName: second.fileName });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
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

  it("does not call an upload the share did not accept a success (412 answers false)", async () => {
    const userId = await makeUser();
    share.putFileContents.mockResolvedValue(false);
    expect(await codeOf(runWebdavSync(userId))).toBe("protocol");
    expect(share.customRequest).not.toHaveBeenCalled();
    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.lastStatus).toBe("failed");
    expect(row.lastSuccessAt).toBeNull();
  });

  it("calls a failed clean-up `partial` with its reason: the export is up, the old ones are not gone", async () => {
    const userId = await makeUser();
    share.customRequest.mockRejectedValue(Object.assign(new Error("x"), { code: "ETIMEDOUT" }));
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
    // Wait until the first run is really inside its upload, however long the
    // export took to build.
    while (share.putFileContents.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await codeOf(runWebdavSync(userId))).toBe("alreadyRunning");
    release();
    await expect(first).resolves.toMatchObject({ status: "ok" });
  });
});

describe("export file names", () => {
  it("are sortable, carry a stable owner tag and match only that owner's pattern", async () => {
    const userId = await makeUser();
    statefulShare();
    const name = (await runWebdavSync(userId)).fileName as string;
    expect(name).toMatch(/^travstats-export-[0-9a-f]{12}-\d{8}T\d{6}Z\.json\.gz$/);
    const again = (await runWebdavSync(userId)).fileName as string;
    expect(again.slice(0, 30)).toBe(name.slice(0, 30));
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

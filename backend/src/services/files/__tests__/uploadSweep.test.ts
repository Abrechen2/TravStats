import { execFileSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { displayRenditionName } from "../../photos/displayRendition";
import type { UploadDirName } from "../../../config/uploadDirs";
import { QUARANTINE_RETENTION_MS, quarantineDirPath } from "../quarantine";
import { UPLOAD_DIR_POLICIES } from "../uploadDirPolicies";
import { listArchivedUploads, sweepAfterFilesRestore } from "../restoreSweep";
import { ORPHAN_GRACE_MS, sweepOrphanUploads, sweepUploadDir } from "../uploadSweep";

/**
 * forgejo#287: the orphan sweep, for every upload directory, and the sweep a
 * restore runs over what it unpacked. Real rows, files under a temporary root.
 */
const TAG = `sweep-${Date.now()}`;
const OLD = ORPHAN_GRACE_MS + 60_000;
const YOUNG = 5 * 60 * 1000;

let root: string;
let userId: string;
let tripId: string;

const put = (dir: string, name: string): void => {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, name), name);
};
const exists = (dir: string, name: string): boolean => fs.existsSync(path.join(root, dir, name));
const held = (dir: UploadDirName, name: string): boolean =>
  fs.existsSync(path.join(quarantineDirPath(root, dir), name));
const ages =
  (young: string[]) =>
  async (_dir: string, name: string): Promise<number> =>
    young.includes(name) ? YOUNG : OLD;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { username: TAG, passwordHash: "x" } })).id;
  tripId = (await prisma.trip.create({ data: { userId, name: "Sweep" } })).id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "upload-sweep-"));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("sweepOrphanUploads", () => {
  it("quarantines an old file no row names and keeps a referenced one with its display copy", async () => {
    const kept = `${TAG}-kept.heic`;
    await prisma.tripPhoto.create({
      data: { tripId, filename: kept, mimetype: "image/heic", sizeBytes: 1 },
    });
    put("trip-photos", kept);
    put("trip-photos", displayRenditionName(kept));
    put("trip-photos", `${TAG}-orphan.jpg`);
    put("trip-photos", displayRenditionName(`${TAG}-orphan.jpg`));

    const [result] = await sweepOrphanUploads({ root, fileAgeMs: ages([]) }).then((rs) =>
      rs.filter((r) => r.dir === "trip-photos")
    );

    expect(result).toEqual({
      dir: "trip-photos",
      quarantined: 2,
      restored: 0,
      purged: 0,
      failed: 0,
    });
    expect(held("trip-photos", `${TAG}-orphan.jpg`)).toBe(true);
    expect(exists("trip-photos", kept)).toBe(true);
    expect(exists("trip-photos", displayRenditionName(kept))).toBe(true);
    expect(exists("trip-photos", `${TAG}-orphan.jpg`)).toBe(false);
  });

  it("keeps an unreferenced file younger than the grace period — an upload in flight", async () => {
    put("place-photos", `${TAG}-inflight.jpg`);
    put("emails", `${TAG}-parsing.eml`);
    put("emails", `${TAG}-abandoned.eml`);

    await sweepOrphanUploads({
      root,
      fileAgeMs: ages([`${TAG}-inflight.jpg`, `${TAG}-parsing.eml`]),
    });

    expect(exists("place-photos", `${TAG}-inflight.jpg`)).toBe(true);
    expect(exists("emails", `${TAG}-parsing.eml`)).toBe(true);
    expect(exists("emails", `${TAG}-abandoned.eml`)).toBe(false);
  });

  it("measures the real mtime when no age function is given", async () => {
    put("lodging-photos", `${TAG}-fresh.jpg`);
    await sweepOrphanUploads({ root });
    expect(exists("lodging-photos", `${TAG}-fresh.jpg`)).toBe(true);

    await sweepOrphanUploads({ root, now: Date.now() + 2 * ORPHAN_GRACE_MS });
    expect(exists("lodging-photos", `${TAG}-fresh.jpg`)).toBe(false);
  });

  it("never sweeps the login backgrounds — the directory is the list", async () => {
    put("login-backgrounds", `${TAG}-bg.jpg`);
    await sweepOrphanUploads({ root, fileAgeMs: ages([]) });
    expect(exists("login-backgrounds", `${TAG}-bg.jpg`)).toBe(true);
  });

  it("keeps an avatar its settings name and removes one they no longer do", async () => {
    const current = `${userId}_${TAG}-now.jpg`;
    await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        data: {
          profile: { profilePicture: `/api/v1/settings/profile-picture/${current}/content` },
        },
      },
      update: {
        data: {
          profile: { profilePicture: `/api/v1/settings/profile-picture/${current}/content` },
        },
      },
    });
    put("profile-pictures", current);
    put("profile-pictures", `${userId}_${TAG}-before.jpg`);

    await sweepOrphanUploads({ root, fileAgeMs: ages([]) });

    expect(exists("profile-pictures", current)).toBe(true);
    expect(exists("profile-pictures", `${userId}_${TAG}-before.jpg`)).toBe(false);
  });

  it("counts a failed move, logs it, and goes on to the next file", async () => {
    put("training", `${TAG}-a.eml`);
    put("training", `${TAG}-b.eml`);
    const realRename = fsp.rename;
    jest.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (String(from).endsWith(`${TAG}-a.eml`)) {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
      return realRename(from, to);
    });
    const warn = jest.spyOn(logger, "warn");

    const result = await sweepUploadDir("training", { root, fileAgeMs: ages([]) });

    expect(result).toEqual({ dir: "training", quarantined: 1, restored: 0, purged: 0, failed: 1 });
    expect(exists("training", `${TAG}-a.eml`)).toBe(true);
    expect(held("training", `${TAG}-b.eml`)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "orphan_sweep_quarantine_failed",
        dir: "training",
        storedName: `${TAG}-a.eml`,
      }),
      expect.any(String)
    );
  });

  it("sweeps note photos by the column on the note, display copy included", async () => {
    const kept = `${TAG}-note.heic`;
    await prisma.note.create({
      data: {
        userId,
        body: "Notiz",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        occurredZone: "Europe/Berlin",
        photoFilename: kept,
        photoMimetype: "image/heic",
        photoSizeBytes: 1,
      },
    });
    put("note-photos", kept);
    put("note-photos", displayRenditionName(kept));
    put("note-photos", `${TAG}-gone.jpg`);

    await sweepOrphanUploads({ root, fileAgeMs: ages([]) });

    expect(exists("note-photos", kept)).toBe(true);
    expect(exists("note-photos", displayRenditionName(kept))).toBe(true);
    expect(held("note-photos", `${TAG}-gone.jpg`)).toBe(true);
  });

  it("keeps sweeping the other directories when one cannot read its references", async () => {
    const rule = UPLOAD_DIR_POLICIES.receipts.sweep;
    if (rule.kind !== "rows") throw new Error("receipts must be swept");
    jest.spyOn(rule, "referenced").mockRejectedValue(new Error("db down"));
    put("receipts", `${TAG}-r.pdf`);
    put("emails", `${TAG}-e.eml`);

    const results = await sweepOrphanUploads({ root, fileAgeMs: ages([]) });

    // Without its references nothing in `receipts` is judged — the safe direction.
    expect(exists("receipts", `${TAG}-r.pdf`)).toBe(true);
    expect(results.find((r) => r.dir === "receipts")).toBeUndefined();
    expect(exists("emails", `${TAG}-e.eml`)).toBe(false);
  });
});

describe("the quarantine", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("holds an orphan instead of deleting it, and purges it only after the retention period", async () => {
    const name = `${TAG}-later.pdf`;
    put("documents", name);
    await sweepUploadDir("documents", { root, fileAgeMs: ages([]) });
    expect(exists("documents", name)).toBe(false);
    expect(held("documents", name)).toBe(true);

    const nearly = await sweepUploadDir("documents", {
      root,
      now: Date.now() + QUARANTINE_RETENTION_MS - DAY,
    });
    expect(nearly.purged).toBe(0);
    expect(held("documents", name)).toBe(true);

    const info = jest.spyOn(logger, "info");
    const past = await sweepUploadDir("documents", {
      root,
      now: Date.now() + QUARANTINE_RETENTION_MS + DAY,
    });
    expect(past.purged).toBe(1);
    expect(held("documents", name)).toBe(false);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "orphan_sweep_purged",
        dir: "documents",
        storedName: name,
      }),
      expect.any(String)
    );
  });

  it("puts a file back when a row references it again — a newer database restored", async () => {
    // A database-only restore to an older point drops this photo's row...
    const name = `${TAG}-comeback.heic`;
    put("trip-photos", name);
    put("trip-photos", displayRenditionName(name));
    await sweepUploadDir("trip-photos", { root, fileAgeMs: ages([]) });
    expect(held("trip-photos", name)).toBe(true);
    expect(held("trip-photos", displayRenditionName(name))).toBe(true);

    // ...and restoring the newer one brings the row back, days later.
    await prisma.tripPhoto.create({
      data: { tripId, filename: name, mimetype: "image/heic", sizeBytes: 1 },
    });
    const result = await sweepUploadDir("trip-photos", { root, now: Date.now() + 10 * DAY });

    expect(result.restored).toBe(2);
    expect(exists("trip-photos", name)).toBe(true);
    expect(exists("trip-photos", displayRenditionName(name))).toBe(true);
    expect(held("trip-photos", name)).toBe(false);
  });

  it("never overwrites a live file with its quarantined namesake", async () => {
    const name = `${TAG}-twice.jpg`;
    await prisma.tripPhoto.create({
      data: { tripId, filename: name, mimetype: "image/jpeg", sizeBytes: 1 },
    });
    fs.mkdirSync(quarantineDirPath(root, "trip-photos"), { recursive: true });
    fs.writeFileSync(path.join(quarantineDirPath(root, "trip-photos"), name), "old");
    put("trip-photos", name);

    const result = await sweepUploadDir("trip-photos", { root, fileAgeMs: ages([]) });

    expect(result.restored).toBe(0);
    expect(fs.readFileSync(path.join(root, "trip-photos", name), "utf8")).toBe(name);

    // The redundant copy still ages out.
    await sweepUploadDir("trip-photos", { root, now: Date.now() + QUARANTINE_RETENTION_MS + 1000 });
    expect(held("trip-photos", name)).toBe(false);
    expect(exists("trip-photos", name)).toBe(true);
  });
});

describe("sweepAfterFilesRestore", () => {
  it("quarantines the archive's files no row names at once, and keeps everything else", async () => {
    const owned = `${TAG}-owned.jpg`;
    await prisma.tripPhoto.create({
      data: { tripId, filename: owned, mimetype: "image/jpeg", sizeBytes: 1 },
    });
    // The archive: a referenced photo, and one of an account deleted since.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "restore-src-"));
    const archive = path.join(staging, "uploads.tar.gz");
    fs.mkdirSync(path.join(staging, "uploads", "trip-photos"), { recursive: true });
    fs.writeFileSync(path.join(staging, "uploads", "trip-photos", owned), "x");
    fs.writeFileSync(path.join(staging, "uploads", "trip-photos", `${TAG}-deleted.jpg`), "x");
    execFileSync("tar", ["-czf", archive, "-C", staging, "uploads"]);
    execFileSync("tar", ["-xzf", archive, "-C", root]);
    const uploadsRoot = path.join(root, "uploads");
    // A file that was already on disk and is young: an upload in flight.
    fs.writeFileSync(path.join(uploadsRoot, "trip-photos", `${TAG}-inflight.jpg`), "x");

    expect(await listArchivedUploads(archive)).toEqual(
      new Set([`trip-photos/${owned}`, `trip-photos/${TAG}-deleted.jpg`])
    );

    await sweepAfterFilesRestore(archive, { root: uploadsRoot });

    const left = fs.readdirSync(path.join(uploadsRoot, "trip-photos")).sort();
    expect(left).toEqual([`${TAG}-inflight.jpg`, owned].sort());
    // Out of the live directory and every later backup, not yet gone for good.
    expect(
      fs.existsSync(path.join(quarantineDirPath(uploadsRoot, "trip-photos"), `${TAG}-deleted.jpg`))
    ).toBe(true);
    fs.rmSync(staging, { recursive: true, force: true });
  });

  it("does not throw when the archive cannot be listed", async () => {
    await expect(
      sweepAfterFilesRestore(path.join(root, "missing.tar.gz"), { root })
    ).resolves.toEqual([]);
  });
});

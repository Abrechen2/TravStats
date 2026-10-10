import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { displayRenditionName } from "../../photos/displayRendition";
import { profilePictureContentUrl } from "../privateFileUrls";
import { collectAccountFiles, deleteAccountWithFiles, removeAccountFiles } from "../accountFiles";
import { sweepOrphanUploads } from "../uploadSweep";
import { shareTrip } from "../../sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
} from "../../../routes/__tests__/sharingFixtures";

/**
 * forgejo#287: deleting an account removes its files in every upload
 * directory — and a missing file, a failed unlink or a failed row delete each
 * end the way they should.
 *
 * Real rows, files under a temporary uploads root.
 */
const TAG = `acctfiles-${Date.now()}`;
const HOUR = 60 * 60 * 1000;

let root: string;
const userIds: string[] = [];

const put = (dir: string, name: string): string => {
  const full = path.join(root, dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${dir}/${name}`);
  return full;
};
const exists = (dir: string, name: string): boolean => fs.existsSync(path.join(root, dir, name));

async function makeUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `${TAG}-${label}`, passwordHash: "x" },
  });
  userIds.push(user.id);
  return user.id;
}

/** One owned file in every directory that holds account files; returns `<dir>/<name>`. */
async function seedAccountFiles(userId: string, label: string): Promise<string[]> {
  const n = (dir: string, ext: string): string => `${TAG}-${label}-${dir}${ext}`;
  const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
  await prisma.tripPhoto.create({
    data: { tripId: trip.id, filename: n("trip", ".heic"), mimetype: "image/heic", sizeBytes: 1 },
  });
  const place = await prisma.place.create({ data: { userId, name: "Ort", lat: 1, lon: 2 } });
  const visit = await prisma.placeVisit.create({
    data: { userId, placeId: place.id, visitedAt: new Date("2026-01-01T00:00:00Z") },
  });
  await prisma.placeVisitPhoto.create({
    data: {
      placeVisitId: visit.id,
      filename: n("place", ".jpg"),
      mimetype: "image/jpeg",
      sizeBytes: 1,
    },
  });
  const lodging = await prisma.lodging.create({ data: { userId, name: "Haus", type: "hotel" } });
  await prisma.lodgingPhoto.create({
    data: {
      lodgingId: lodging.id,
      filename: n("lodging", ".jpg"),
      mimetype: "image/jpeg",
      sizeBytes: 1,
    },
  });
  await prisma.document.create({
    data: {
      userId,
      storedName: n("doc", ".pdf"),
      mimetype: "application/pdf",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      format: "pdf",
    },
  });
  await prisma.receiptUpload.create({ data: { userId, filename: n("receipt", ".pdf") } });
  // An absolute path from another machine, as a restored row carries it.
  await prisma.trainingData.create({
    data: {
      userId,
      type: "email",
      originalFile: `/elsewhere/uploads/training/${n("training", ".eml")}`,
      annotations: {},
      extractedData: {},
    },
  });
  await prisma.note.create({
    data: {
      userId,
      body: "Notiz",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      occurredZone: "Europe/Berlin",
      photoFilename: n("note", ".heic"),
      photoMimetype: "image/heic",
      photoSizeBytes: 1,
    },
  });
  const avatar = `${userId}_${TAG}.jpg`;
  await prisma.userSettings.create({
    data: { userId, data: { profile: { profilePicture: profilePictureContentUrl(avatar) } } },
  });

  const files = [
    `trip-photos/${n("trip", ".heic")}`,
    `trip-photos/${displayRenditionName(n("trip", ".heic"))}`,
    `place-photos/${n("place", ".jpg")}`,
    `lodging-photos/${n("lodging", ".jpg")}`,
    `documents/${n("doc", ".pdf")}`,
    `receipts/${n("receipt", ".pdf")}`,
    `training/${n("training", ".eml")}`,
    `note-photos/${n("note", ".heic")}`,
    `note-photos/${displayRenditionName(n("note", ".heic"))}`,
    `profile-pictures/${avatar}`,
    // A replaced avatar the settings no longer name: still the account's.
    `profile-pictures/${userId}_${TAG}-old.jpg`,
  ];
  for (const f of files) put(path.dirname(f), path.basename(f));
  return files;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "account-files-"));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("deleteAccountWithFiles", () => {
  it("removes the account's files in every upload directory and nobody else's", async () => {
    const doomed = await makeUser("doomed");
    const other = await makeUser("other");
    const doomedFiles = await seedAccountFiles(doomed, "doomed");
    const otherFiles = await seedAccountFiles(other, "other");
    // Instance and transient files belong to no account.
    put("login-backgrounds", `${TAG}-bg.jpg`);
    put("emails", `${TAG}-mail.eml`);

    await deleteAccountWithFiles(doomed, () => prisma.user.delete({ where: { id: doomed } }), {
      root,
    });

    expect(await prisma.user.findUnique({ where: { id: doomed } })).toBeNull();
    expect(doomedFiles.filter((f) => fs.existsSync(path.join(root, f)))).toEqual([]);
    expect(otherFiles.filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
    expect(exists("login-backgrounds", `${TAG}-bg.jpg`)).toBe(true);
    expect(exists("emails", `${TAG}-mail.eml`)).toBe(true);
  });

  it("deletes the account when a file is already gone, and counts it as missing", async () => {
    const userId = await makeUser("missing");
    await prisma.receiptUpload.create({ data: { userId, filename: `${TAG}-gone.pdf` } });

    const files = await collectAccountFiles(userId, { root });
    await prisma.user.delete({ where: { id: userId } });
    const result = await removeAccountFiles(userId, files, { root });

    expect(result).toEqual({ removed: 0, missing: 1, failed: 0, kept: 0 });
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
  });

  it("logs a failed unlink with its context, deletes the account anyway, and leaves the file to the sweep", async () => {
    const userId = await makeUser("eacces");
    const name = `${TAG}-stuck.pdf`;
    await prisma.receiptUpload.create({ data: { userId, filename: name } });
    put("receipts", name);
    const realUnlink = fsp.unlink;
    jest.spyOn(fsp, "unlink").mockImplementation(async (target) => {
      if (String(target).endsWith(name)) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return realUnlink(target);
    });
    const warn = jest.spyOn(logger, "warn");

    await deleteAccountWithFiles(userId, () => prisma.user.delete({ where: { id: userId } }), {
      root,
    });

    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(exists("receipts", name)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "account_delete_unlink_failed",
        dir: "receipts",
        storedName: name,
        userId,
        error: expect.objectContaining({ code: "EACCES" }),
      }),
      expect.any(String)
    );

    // The next sweep run finds it: no row names it any more.
    jest.mocked(fsp.unlink).mockRestore();
    // ...into the quarantine: out of the product and every later backup.
    await sweepOrphanUploads({ root, now: Date.now() + 2 * HOUR });
    expect(exists("receipts", name)).toBe(false);
  });

  it("touches no file when the row delete fails", async () => {
    const userId = await makeUser("rowsfail");
    const files = await seedAccountFiles(userId, "rowsfail");

    await expect(
      deleteAccountWithFiles(
        userId,
        async () => {
          throw new Error("database down");
        },
        { root }
      )
    ).rejects.toThrow("database down");

    expect(files.filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
  });

  it("keeps a file a surviving row still names", async () => {
    const doomed = await makeUser("shared-a");
    const keeper = await makeUser("shared-b");
    const shared = `${TAG}-shared.jpg`;
    for (const userId of [doomed, keeper]) {
      const trip = await prisma.trip.create({ data: { userId, name: "Geteilt" } });
      await prisma.tripPhoto.create({
        data: { tripId: trip.id, filename: shared, mimetype: "image/jpeg", sizeBytes: 1 },
      });
    }
    put("trip-photos", shared);

    const files = await collectAccountFiles(doomed, { root });
    await prisma.user.delete({ where: { id: doomed } });
    const result = await removeAccountFiles(doomed, files, { root });

    expect(result.kept).toBe(1);
    expect(exists("trip-photos", shared)).toBe(true);
  });

  it("keeps every file across a shared trip, whichever of the two accounts is deleted", async () => {
    const owner = await makeAccount(`${TAG}-owner`);
    const member = await makeAccount(`${TAG}-member`);
    userIds.push(owner.id, member.id);
    const companion = await linkWithConsent(owner, member);
    const { trip, lodging } = await makeFullTrip(owner);

    // The owner's files on the trip: a photo (also the cover), a lodging
    // photo, a document filed with the trip.
    const ownerPhoto = `${TAG}-owner-trip.jpg`;
    const photo = await prisma.tripPhoto.create({
      data: { tripId: trip.id, filename: ownerPhoto, mimetype: "image/jpeg", sizeBytes: 1 },
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { coverImageUrl: `/api/v1/trips/${trip.id}/photos/${photo.id}/file` },
    });
    const ownerLodgingPhoto = `${TAG}-owner-lodging.jpg`;
    await prisma.lodgingPhoto.create({
      data: {
        lodgingId: lodging.id,
        filename: ownerLodgingPhoto,
        mimetype: "image/jpeg",
        sizeBytes: 1,
      },
    });
    const ownerDoc = `${TAG}-owner-doc.pdf`;
    await prisma.document.create({
      data: {
        userId: owner.id,
        tripId: trip.id,
        storedName: ownerDoc,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        format: "pdf",
      },
    });
    const ownerFiles = [
      `trip-photos/${ownerPhoto}`,
      `lodging-photos/${ownerLodgingPhoto}`,
      `documents/${ownerDoc}`,
    ];

    await shareTrip(owner.id, trip.id, companion.id);
    const copy = await prisma.trip.findFirstOrThrow({ where: { userId: member.id } });
    const memberPhoto = `${TAG}-member-trip.jpg`;
    await prisma.tripPhoto.create({
      data: { tripId: copy.id, filename: memberPhoto, mimetype: "image/jpeg", sizeBytes: 1 },
    });
    for (const f of [...ownerFiles, `trip-photos/${memberPhoto}`]) {
      put(path.dirname(f), path.basename(f));
    }

    // The copies carry facts only: no row of the member names an owner file.
    const memberFiles = await collectAccountFiles(member.id, { root });
    expect([...memberFiles.entries()]).toEqual([["trip-photos", [memberPhoto]]]);

    // The owner goes first: the member's copy and its own photo stay.
    await deleteAccountWithFiles(owner.id, () => prisma.user.delete({ where: { id: owner.id } }), {
      root,
    });
    expect(ownerFiles.filter((f) => fs.existsSync(path.join(root, f)))).toEqual([]);
    expect(exists("trip-photos", memberPhoto)).toBe(true);
    expect(await prisma.trip.count({ where: { id: copy.id } })).toBe(1);

    // Then the member, with its own file only.
    await deleteAccountWithFiles(
      member.id,
      () => prisma.user.delete({ where: { id: member.id } }),
      {
        root,
      }
    );
    expect(exists("trip-photos", memberPhoto)).toBe(false);
  });

  it("deleting the member of a shared trip leaves the owner's files", async () => {
    const owner = await makeAccount(`${TAG}-owner2`);
    const member = await makeAccount(`${TAG}-member2`);
    userIds.push(owner.id, member.id);
    const companion = await linkWithConsent(owner, member);
    const { trip } = await makeFullTrip(owner);
    const ownerPhoto = `${TAG}-owner2-trip.jpg`;
    await prisma.tripPhoto.create({
      data: { tripId: trip.id, filename: ownerPhoto, mimetype: "image/jpeg", sizeBytes: 1 },
    });
    put("trip-photos", ownerPhoto);
    await shareTrip(owner.id, trip.id, companion.id);

    await deleteAccountWithFiles(
      member.id,
      () => prisma.user.delete({ where: { id: member.id } }),
      {
        root,
      }
    );

    expect(exists("trip-photos", ownerPhoto)).toBe(true);
    expect(await prisma.tripPhoto.count({ where: { filename: ownerPhoto } })).toBe(1);
  });
});

import path from "path";

import { prisma } from "../../db";
import type { UploadDirName } from "../../config/uploadDirs";
import { listUploadFiles } from "./uploadFiles";
import { profilePictureFileNameFromUrl, receiptFileNameFromUrl } from "./privateFileUrls";

/**
 * What deleting an account takes from each upload directory, and what the
 * orphan sweep keeps there (forgejo#287).
 *
 * Deleting an account cascaded every row and left every byte: trip, place and
 * lodging photos, documents, receipts, avatars, training samples — still on
 * disk and in every later backup. The table below is the one place that says,
 * per directory, which rows own which files; `accountFiles.ts` and
 * `uploadSweep.ts` both read it and nothing else. It is keyed by
 * `UploadDirName`, so a directory added to `BACKED_UP_UPLOAD_DIRS` does not
 * compile until it has a row here, and `__tests__/uploadDirPolicies.test.ts`
 * fails for a directory constant that is not in that list at all.
 *
 * A directory that holds no account's files says so, with the reason, rather
 * than being left out — an omission and a decision must not look alike.
 */

/** Which stored names in a directory belong to one account. */
export type AccountFilesRule =
  | { kind: "rows"; namesOf: (userId: string, dirPath: string) => Promise<string[]> }
  | { kind: "none"; reason: string };

/** Which stored names some row still needs; every other file past the grace period is an orphan. */
export type SweepRule =
  { kind: "rows"; referenced: () => Promise<Iterable<string>> } | { kind: "none"; reason: string };

export interface UploadDirPolicy {
  account: AccountFilesRule;
  sweep: SweepRule;
}

/**
 * The common shape: a model with a `filename` column, owned through a path to
 * a user. `load(null)` reads every row, `load(userId)` one account's. A new
 * photo directory is one entry built from this, e.g. for `note-photos`:
 *
 *   "note-photos": filenameRows((userId) =>
 *     prisma.notePhoto.findMany({ where: userId ? { note: { userId } } : {}, select: { filename: true } })),
 *
 * A HEIC original's `<name>.display.jpg` (forgejo#192) needs no entry of its
 * own — the deletion step and the sweep both treat it as part of its original.
 */
export function filenameRows(
  load: (userId: string | null) => Promise<Array<{ filename: string | null }>>
): UploadDirPolicy {
  const names = async (userId: string | null): Promise<string[]> =>
    (await load(userId)).flatMap((r) => (r.filename ? [path.basename(r.filename)] : []));
  return {
    account: { kind: "rows", namesOf: (userId) => names(userId) },
    sweep: { kind: "rows", referenced: () => names(null) },
  };
}

/** Receipt files from before receipts became documents: their own row, or a legacy URL on an entry. */
async function referencedReceipts(): Promise<string[]> {
  const legacy = { receiptUrl: { startsWith: "/api/v1/uploads/receipts/" } };
  const [uploads, flights, stays] = await Promise.all([
    prisma.receiptUpload.findMany({ select: { filename: true } }),
    prisma.flight.findMany({ where: legacy, select: { receiptUrl: true } }),
    prisma.lodgingStay.findMany({ where: legacy, select: { receiptUrl: true } }),
  ]);
  return [
    ...uploads.map((u) => path.basename(u.filename)),
    ...[...flights, ...stays].flatMap((r) => {
      const name = receiptFileNameFromUrl(r.receiptUrl);
      return name ? [name] : [];
    }),
  ];
}

/** Every avatar a settings row still names. */
async function referencedAvatars(): Promise<string[]> {
  const rows = await prisma.userSettings.findMany({ select: { data: true } });
  return rows.flatMap((r) => {
    const profile = (r.data as { profile?: { profilePicture?: unknown } } | null)?.profile;
    const url = typeof profile?.profilePicture === "string" ? profile.profilePicture : null;
    const name = profilePictureFileNameFromUrl(url);
    return name ? [name] : [];
  });
}

/** A training sample stores an absolute path; the file is the basename in this directory. */
async function trainingNames(userId: string | null): Promise<string[]> {
  const rows = await prisma.trainingData.findMany({
    where: userId ? { userId } : {},
    select: { originalFile: true },
  });
  return rows.map((r) => path.basename(r.originalFile));
}

async function documentNames(userId: string | null): Promise<string[]> {
  const rows = await prisma.document.findMany({
    where: userId ? { userId } : {},
    select: { storedName: true },
  });
  return rows.map((r) => path.basename(r.storedName));
}

export const UPLOAD_DIR_POLICIES: Readonly<Record<UploadDirName, UploadDirPolicy>> = {
  receipts: {
    account: {
      kind: "rows",
      namesOf: async (userId) =>
        (
          await prisma.receiptUpload.findMany({ where: { userId }, select: { filename: true } })
        ).map((r) => path.basename(r.filename)),
    },
    sweep: { kind: "rows", referenced: referencedReceipts },
  },
  emails: {
    account: {
      kind: "none",
      reason:
        "Transient: an uploaded mail is parsed and unlinked within its request, and no row records whose it was.",
    },
    // Nothing references these, so everything past the grace period is a
    // leftover of a request that died between upload and cleanup.
    sweep: { kind: "rows", referenced: async () => [] },
  },
  training: {
    account: { kind: "rows", namesOf: (userId) => trainingNames(userId) },
    sweep: { kind: "rows", referenced: () => trainingNames(null) },
  },
  "trip-photos": filenameRows((userId) =>
    prisma.tripPhoto.findMany({
      where: userId ? { trip: { userId } } : {},
      select: { filename: true },
    })
  ),
  "place-photos": filenameRows((userId) =>
    prisma.placeVisitPhoto.findMany({
      where: userId ? { visit: { userId } } : {},
      select: { filename: true },
    })
  ),
  "lodging-photos": filenameRows((userId) =>
    prisma.lodgingPhoto.findMany({
      where: userId ? { lodging: { userId } } : {},
      select: { filename: true },
    })
  ),
  // A note's one photo (forgejo#137): the name lives on the note itself. Was
  // missing when the notes branch and the account-files branch met.
  "note-photos": filenameRows(async (userId) =>
    (
      await prisma.note.findMany({
        where: userId ? { userId } : {},
        select: { photoFilename: true },
      })
    ).map((n) => ({ filename: n.photoFilename }))
  ),
  "profile-pictures": {
    // The owner is in the name (`<userId>_<ts>-<rand><ext>`), so every avatar
    // the account ever left behind goes, not only the one its settings name.
    account: {
      kind: "rows",
      namesOf: async (userId, dirPath) =>
        (await listUploadFiles(dirPath)).filter((n) => n.startsWith(`${userId}_`)),
    },
    sweep: { kind: "rows", referenced: referencedAvatars },
  },
  documents: {
    account: { kind: "rows", namesOf: (userId) => documentNames(userId) },
    sweep: { kind: "rows", referenced: () => documentNames(null) },
  },
  "login-backgrounds": {
    account: {
      kind: "none",
      reason: "Instance decoration uploaded by an admin; no account owns these.",
    },
    sweep: {
      kind: "none",
      reason: "The directory IS the list — no row names a background, so every file is wanted.",
    },
  },
};

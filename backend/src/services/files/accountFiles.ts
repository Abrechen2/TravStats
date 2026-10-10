import path from "path";

import { BACKED_UP_UPLOAD_DIRS, UPLOADS_ROOT, type UploadDirName } from "../../config/uploadDirs";
import logger from "../../utils/logger";
import { displayRenditionName } from "../photos/displayRendition";
import { UPLOAD_DIR_POLICIES } from "./uploadDirPolicies";
import { recordPendingDeletions } from "./pendingDeletions";
import { isReferenced, unlinkUpload } from "./uploadFiles";

/**
 * The one account-file deletion step (forgejo#287). Every path that deletes an
 * account — the admin's `DELETE /admin/users/:id`, the demo reseed's wipe —
 * runs its row deletion through `deleteAccountWithFiles`.
 *
 * The order is the point:
 *   1. collect the names while the rows that own them still exist;
 *   2. delete the rows — the caller's step, and the one that must succeed;
 *   3. remove the files, never throwing.
 * A missing file is not an error, a failed unlink is logged with the account,
 * directory and stored name and recorded in the pending-deletion manifest,
 * which the next sweep run retries and deletes outright (`pendingDeletions.ts`)
 * — the user asked for deletion, so such a file is not quarantined like an
 * orphan. A row deletion that fails leaves every file where it was.
 *
 * Unlike the sweep, this step deletes outright: removing an account is an
 * explicit request, not an inference from missing rows.
 *
 * Across accounts: a trip shared with another account is a set of linked
 * COPIES (`services/sharing/`) that carry facts only — no photo, cover,
 * document or receipt reference travels (`sharing/facts/*`) — so no row of
 * one account names another's file. Should one ever do so, step 3 asks which
 * names any remaining row still references, across every account, and keeps
 * those.
 */

export type AccountFileSet = ReadonlyMap<UploadDirName, readonly string[]>;

export interface AccountFileRemoval {
  removed: number;
  missing: number;
  failed: number;
  /** Still named by a row after the delete — another account's, so left alone. */
  kept: number;
}

interface Options {
  /** The uploads root; tests point it at a temporary directory. */
  root?: string;
}

/** Every stored name the account owns, per directory. A directory that cannot be read is logged and skipped. */
export async function collectAccountFiles(
  userId: string,
  options: Options = {}
): Promise<AccountFileSet> {
  const root = options.root ?? UPLOADS_ROOT;
  const byDir = new Map<UploadDirName, string[]>();
  for (const dir of BACKED_UP_UPLOAD_DIRS) {
    const rule = UPLOAD_DIR_POLICIES[dir].account;
    if (rule.kind === "none") continue;
    try {
      const names = await rule.namesOf(userId, path.join(root, dir));
      if (names.length > 0) byDir.set(dir, names);
    } catch (error) {
      // The delete must not hang on this: the sweep finds these files once
      // their rows are gone.
      logger.warn(
        {
          operation: "account_files_collect_failed",
          userId,
          dir,
          error: { message: error instanceof Error ? error.message : String(error) },
        },
        "Could not list an account's files in one upload directory; the orphan sweep will quarantine them"
      );
    }
  }
  return byDir;
}

/**
 * Removes the collected files. Never throws. Before it unlinks anything in a
 * directory it asks which names a row STILL references — a file shared with a
 * row that survived the delete is not the account's alone, and stays.
 */
export async function removeAccountFiles(
  userId: string,
  files: AccountFileSet,
  options: Options = {}
): Promise<AccountFileRemoval> {
  const root = options.root ?? UPLOADS_ROOT;
  const totals: AccountFileRemoval = { removed: 0, missing: 0, failed: 0, kept: 0 };
  // Every path that could not be removed now, for the sweep to delete outright
  // — not to quarantine for thirty days (`pendingDeletions.ts`).
  const pending: Array<{ dir: UploadDirName; storedName: string; userId: string }> = [];
  for (const [dir, names] of files) {
    const dirPath = path.join(root, dir);
    const sweep = UPLOAD_DIR_POLICIES[dir].sweep;
    let stillReferenced: ReadonlySet<string> = new Set();
    try {
      if (sweep.kind === "rows") stillReferenced = new Set(await sweep.referenced());
    } catch (error) {
      logger.warn(
        {
          operation: "account_files_reference_check_failed",
          userId,
          dir,
          error: { message: error instanceof Error ? error.message : String(error) },
        },
        "Could not check an upload directory's references; its files are left to the orphan sweep"
      );
      totals.failed += names.length;
      // The retry checks references itself before deleting anything.
      for (const name of names) pending.push({ dir, storedName: path.basename(name), userId });
      continue;
    }
    for (const name of names) {
      if (isReferenced(name, stillReferenced)) {
        totals.kept++;
        continue;
      }
      const context = { operation: "account_delete", dir, userId };
      const outcome = await unlinkUpload(dirPath, name, context);
      totals[outcome]++;
      if (outcome === "failed") pending.push({ dir, storedName: path.basename(name), userId });
      // A HEIC original's display copy (forgejo#192) goes with it; most
      // files have none, which is `missing` and not counted.
      const rendition = displayRenditionName(name);
      if ((await unlinkUpload(dirPath, rendition, context)) === "failed") {
        totals.failed++;
        pending.push({ dir, storedName: rendition, userId });
      }
    }
  }
  await recordPendingDeletions(root, pending);
  logger.info(
    { operation: "account_files_removed", userId, ...totals },
    "Removed the deleted account's uploaded files"
  );
  return totals;
}

/**
 * Deletes an account's rows through `deleteRows` and then its files. Returns
 * what `deleteRows` returned; a failure there propagates and no file is touched.
 */
export async function deleteAccountWithFiles<T>(
  userId: string,
  deleteRows: () => Promise<T>,
  options: Options = {}
): Promise<T> {
  const files = await collectAccountFiles(userId, options);
  const result = await deleteRows();
  await removeAccountFiles(userId, files, options);
  return result;
}

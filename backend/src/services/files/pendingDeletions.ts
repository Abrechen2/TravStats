import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";

import { BACKED_UP_UPLOAD_DIRS, type UploadDirName } from "../../config/uploadDirs";
import logger from "../../utils/logger";
import { quarantineDirPath } from "./quarantine";
import { UPLOAD_DIR_POLICIES } from "./uploadDirPolicies";
import { isReferenced, unlinkUpload } from "./uploadFiles";

/**
 * Files an account deletion could not remove, kept until they are (forgejo#287).
 *
 * The orphan sweep would find them too, but it only QUARANTINES — for thirty
 * days, because an unreferenced file may belong to a database restored to an
 * older point. A deleted account's file is not that case: the user asked for
 * it to be gone. So the deletion step writes every path it failed on into this
 * manifest, and the sweep retries those first and deletes them outright —
 * live copy and, should the sweep have moved it meanwhile, quarantined copy.
 * An entry leaves the manifest when its file is gone, and stays (logged, with
 * its attempt count) while the unlink keeps failing.
 *
 * One safety rule before every delete: a file a row references again is not
 * the deleted account's any more (a restore brought its row back). Its entry
 * is dropped and the file kept.
 *
 * The manifest is `uploads/.pending-deletions.json` — outside every backed-up
 * directory, so it is neither archived nor restored — and is replaced
 * atomically (written beside, then renamed). Writes are serialised in-process;
 * the sweep and account deletion run in the one server process.
 */
export const PENDING_DELETIONS_FILE = ".pending-deletions.json";

export interface PendingDeletion {
  dir: UploadDirName;
  storedName: string;
  userId: string;
  /** ISO instant of the first failure. */
  since: string;
  attempts: number;
}

const manifestPath = (root: string): string => path.join(root, PENDING_DELETIONS_FILE);
const keyOf = (e: Pick<PendingDeletion, "dir" | "storedName">): string =>
  `${e.dir}/${e.storedName}`;

let queue: Promise<unknown> = Promise.resolve();
/** Runs `task` after every earlier manifest operation, whatever became of them. */
function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readManifest(root: string): Promise<PendingDeletion[]> {
  let text: string;
  try {
    text = await fsp.readFile(manifestPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const dirs: readonly string[] = BACKED_UP_UPLOAD_DIRS;
  const parsed: unknown = JSON.parse(text);
  // Untrusted as any file on disk: keep only well-formed entries for known directories.
  return Array.isArray(parsed)
    ? parsed.filter(
        (e): e is PendingDeletion =>
          typeof e?.dir === "string" &&
          dirs.includes(e.dir) &&
          typeof e?.storedName === "string" &&
          e.storedName === path.basename(e.storedName) &&
          typeof e?.userId === "string" &&
          typeof e?.since === "string" &&
          typeof e?.attempts === "number"
      )
    : [];
}

async function writeManifest(root: string, entries: PendingDeletion[]): Promise<void> {
  if (entries.length === 0) {
    await fsp.rm(manifestPath(root), { force: true });
    return;
  }
  await fsp.mkdir(root, { recursive: true });
  const temp = `${manifestPath(root)}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(entries, null, 2));
  await fsp.rename(temp, manifestPath(root));
}

/** Records failed deletions. Never throws: the account is deleted either way. */
export async function recordPendingDeletions(
  root: string,
  failures: ReadonlyArray<Pick<PendingDeletion, "dir" | "storedName" | "userId">>,
  now = Date.now()
): Promise<void> {
  if (failures.length === 0) return;
  await serialised(async () => {
    const entries = await readManifest(root);
    const known = new Set(entries.map(keyOf));
    for (const f of failures) {
      if (known.has(keyOf(f))) continue;
      entries.push({ ...f, since: new Date(now).toISOString(), attempts: 1 });
      known.add(keyOf(f));
    }
    await writeManifest(root, entries);
  }).catch((error) => {
    logger.error(
      {
        operation: "pending_deletions_record_failed",
        failures,
        error: { message: error instanceof Error ? error.message : String(error) },
      },
      "Could not record files a deletion failed to remove; the orphan sweep quarantines them instead"
    );
  });
}

export interface PendingRetryResult {
  deleted: number;
  keptReferenced: number;
  stillFailing: number;
}

/** Retries every recorded deletion. Never throws. */
export async function retryPendingDeletions(root: string): Promise<PendingRetryResult> {
  const result: PendingRetryResult = { deleted: 0, keptReferenced: 0, stillFailing: 0 };
  await serialised(async () => {
    const entries = await readManifest(root);
    if (entries.length === 0) return;
    const referencedByDir = new Map<UploadDirName, Set<string> | null>();
    const remaining: PendingDeletion[] = [];
    for (const entry of entries) {
      if (!referencedByDir.has(entry.dir)) {
        const rule = UPLOAD_DIR_POLICIES[entry.dir].sweep;
        try {
          referencedByDir.set(
            entry.dir,
            new Set(rule.kind === "rows" ? await rule.referenced() : [])
          );
        } catch {
          referencedByDir.set(entry.dir, null);
        }
      }
      const referenced = referencedByDir.get(entry.dir);
      // References unreadable: no safe judgement this run.
      if (referenced === null || referenced === undefined) {
        remaining.push(entry);
        continue;
      }
      if (isReferenced(entry.storedName, referenced)) {
        result.keptReferenced++;
        logger.warn(
          { operation: "pending_deletion_referenced_again", ...entry },
          "A file pending deletion is referenced by a row again; kept, entry dropped"
        );
        continue;
      }
      const context = { operation: "pending_deletion", dir: entry.dir, userId: entry.userId };
      const outcomes = [
        await unlinkUpload(path.join(root, entry.dir), entry.storedName, context),
        await unlinkUpload(quarantineDirPath(root, entry.dir), entry.storedName, context),
      ];
      if (outcomes.includes("failed")) {
        result.stillFailing++;
        const next = { ...entry, attempts: entry.attempts + 1 };
        remaining.push(next);
        logger.warn(
          { operation: "pending_deletion_still_failing", ...next },
          "A deleted account's file still cannot be removed; kept for the next run"
        );
        continue;
      }
      result.deleted++;
      logger.info(
        {
          operation: "pending_deletion_completed",
          dir: entry.dir,
          storedName: entry.storedName,
          userId: entry.userId,
        },
        "Removed a deleted account's file on retry"
      );
    }
    await writeManifest(root, remaining);
  }).catch((error) => {
    logger.warn(
      {
        operation: "pending_deletions_retry_failed",
        error: { message: error instanceof Error ? error.message : String(error) },
      },
      "Could not process the pending-deletion manifest; the next run retries"
    );
  });
  return result;
}

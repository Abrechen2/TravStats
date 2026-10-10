import fsp from "fs/promises";
import path from "path";

import type { UploadDirName } from "../../config/uploadDirs";
import logger from "../../utils/logger";

/**
 * Where the orphan sweep puts a file instead of deleting it (forgejo#287).
 *
 * "No row references this file" is a statement about the database as it is
 * NOW, and the database can move backwards: a database-only restore to an
 * older dump drops the rows of every photo, document and receipt uploaded
 * since, while their files stay on disk. A sweep that deleted on that evidence
 * destroyed them for good, and restoring the newer dump afterwards brought
 * back rows whose files were gone.
 *
 * So the sweep moves an orphan to `uploads/.quarantine/<dir>/<name>`, and on
 * every run looks at the quarantine again:
 *   - a file a row references once more goes back where it was — the restore
 *     path, which needs nobody to do anything;
 *   - a file still unreferenced after `QUARANTINE_RETENTION_MS` is deleted.
 *
 * The quarantine is not an upload directory: nothing serves it and the backup
 * does not archive it (it archives `BACKED_UP_UPLOAD_DIRS` and nothing else),
 * so a quarantined file is out of the product and out of every later backup
 * from the moment it is moved. Deleting an account is an explicit request and
 * does NOT go through here — its files are unlinked at once.
 *
 * The time a file entered the quarantine is its mtime, stamped on the move.
 */
export const QUARANTINE_DIR_NAME = ".quarantine";

/**
 * Thirty days: the owner's number for how long an unfiled document is kept
 * before it is deleted, and so the span the instance already promises for
 * "you can still get this back". It is also long enough for an administrator
 * to notice that a restore went to the wrong point and restore again — the
 * case this whole directory exists for.
 */
export const QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function quarantineDirPath(root: string, dir: UploadDirName): string {
  return path.join(root, QUARANTINE_DIR_NAME, dir);
}

const errorOf = (error: unknown) => ({
  code: (error as NodeJS.ErrnoException).code,
  message: error instanceof Error ? error.message : String(error),
});

/** Moves a live file into the quarantine. Never throws. */
export async function quarantineUpload(
  root: string,
  dir: UploadDirName,
  storedName: string,
  now: number
): Promise<"quarantined" | "missing" | "failed"> {
  const name = path.basename(storedName);
  const target = path.join(quarantineDirPath(root, dir), name);
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(path.join(root, dir, name), target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    logger.warn(
      { operation: "orphan_sweep_quarantine_failed", dir, storedName: name, error: errorOf(error) },
      "Could not move an orphaned upload into the quarantine; the next run retries"
    );
    return "failed";
  }
  try {
    // The clock of the retention period. A failure here only means the file
    // is judged by its upload time instead — earlier, never lost unasked.
    const stamp = new Date(now);
    await fsp.utimes(target, stamp, stamp);
  } catch (error) {
    logger.warn(
      {
        operation: "orphan_sweep_quarantine_stamp_failed",
        dir,
        storedName: name,
        error: errorOf(error),
      },
      "Could not stamp a quarantined upload's time"
    );
  }
  return "quarantined";
}

/**
 * Puts a quarantined file back. A live file of the same name wins — it is
 * newer than anything the sweep took — and the quarantined copy is left to
 * its retention period.
 */
export async function restoreFromQuarantine(
  root: string,
  dir: UploadDirName,
  storedName: string
): Promise<"restored" | "shadowed" | "failed"> {
  const name = path.basename(storedName);
  const live = path.join(root, dir, name);
  try {
    await fsp.access(live);
    return "shadowed";
  } catch {
    // Absent: the ordinary case.
  }
  try {
    await fsp.mkdir(path.dirname(live), { recursive: true });
    await fsp.rename(path.join(quarantineDirPath(root, dir), name), live);
    return "restored";
  } catch (error) {
    logger.warn(
      {
        operation: "orphan_sweep_unquarantine_failed",
        dir,
        storedName: name,
        error: errorOf(error),
      },
      "Could not move a referenced upload back out of the quarantine; the next run retries"
    );
    return "failed";
  }
}

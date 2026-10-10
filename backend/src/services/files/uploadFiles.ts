import fsp from "fs/promises";
import path from "path";

import logger from "../../utils/logger";

/**
 * The three file operations the account-deletion step and the orphan sweep
 * share (forgejo#287). Every path is rebuilt from a trusted directory plus the
 * `basename` of a stored name, never from anything a client sent.
 */

/** What became of one unlink. `missing` is not a failure: the file was already gone. */
export type UnlinkOutcome = "removed" | "missing" | "failed";

export interface UnlinkContext {
  /** Which job asked — `account_delete`, `orphan_sweep`. */
  operation: string;
  dir: string;
  /** The account being deleted, when there is one. */
  userId?: string;
}

/**
 * Removes one stored file. Never throws: the caller is either past a database
 * delete that must stand, or a sweep that must go on to the next file. A
 * failure is logged with enough context to find the file again, and the next
 * sweep run retries it, because by then no row names it.
 */
export async function unlinkUpload(
  dirPath: string,
  storedName: string,
  context: UnlinkContext
): Promise<UnlinkOutcome> {
  const name = path.basename(storedName);
  try {
    await fsp.unlink(path.join(dirPath, name));
    return "removed";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "missing";
    // By stored name only — never a user's original file name or content.
    logger.warn(
      {
        operation: `${context.operation}_unlink_failed`,
        dir: context.dir,
        storedName: name,
        ...(context.userId ? { userId: context.userId } : {}),
        error: { code, message: (error as Error).message },
      },
      "Could not remove an uploaded file; the orphan sweep retries it"
    );
    return "failed";
  }
}

/** The regular files in a directory; an absent directory has none. */
export async function listUploadFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** How long ago a file was last written, or null when it is gone. */
export async function uploadFileAgeMs(
  dirPath: string,
  storedName: string,
  now: number
): Promise<number | null> {
  try {
    return now - (await fsp.stat(path.join(dirPath, path.basename(storedName)))).mtimeMs;
  } catch {
    return null;
  }
}

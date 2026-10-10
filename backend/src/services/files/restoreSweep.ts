import { spawn } from "child_process";

import logger from "../../utils/logger";
import { sweepOrphanUploads, type DirSweepResult } from "./uploadSweep";

/**
 * Restoring an archive must not bring back the files of accounts that no
 * longer exist (forgejo#287).
 *
 * It could, three ways. An archive written before account deletion removed
 * files carries every deleted account's photos and documents; a FILES-only
 * restore unpacks an archive's files over a database in which some of their
 * accounts have since been deleted; and `tar` extracts by merging, so nothing
 * it unpacks is ever judged against the rows that are now in the database.
 *
 * So once the files are on disk, the orphan sweep runs over every directory,
 * and for the files the archive itself carried it waives the grace period:
 * `tar` restores each file's original mtime, but these are not uploads in
 * flight — they came out of the archive, and the rows that are now in the
 * database decide alone whether they stay. Files that were already on disk
 * keep their grace as always. A full restore runs this after the database, so
 * the rows that judge are the archive's own.
 *
 * "Go" means into the quarantine, like every orphan: out of the live
 * directory, unserved and out of every later backup at once, deleted after the
 * retention period — and back again if a later restore brings their rows.
 */

/** `<dir>/<name>` for every file under `uploads/` in an uploads archive. */
export async function listArchivedUploads(archivePath: string): Promise<Set<string>> {
  const output = await new Promise<string>((resolve, reject) => {
    const tar = spawn("tar", ["-tzf", archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    tar.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    tar.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    tar.on("close", (code: number) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`tar listing failed with code ${code}: ${stderr.trim()}`))
    );
    tar.on("error", reject);
  });
  const entries = new Set<string>();
  for (const line of output.split("\n")) {
    // `uploads/<dir>/<name>` — directory entries end in `/` and are skipped.
    const match = /^(?:\.\/)?uploads\/([^/]+)\/([^/]+)$/.exec(line.trim());
    if (match) entries.add(`${match[1]}/${match[2]}`);
  }
  return entries;
}

/**
 * Sweeps after a restore unpacked `archivePath`. Never throws — the restore
 * itself has succeeded by now; a failure here is logged and the hourly sweep
 * takes over.
 */
export async function sweepAfterFilesRestore(
  archivePath: string,
  options: { root?: string } = {}
): Promise<DirSweepResult[]> {
  try {
    const noGrace = await listArchivedUploads(archivePath);
    const results = await sweepOrphanUploads({ ...options, noGrace });
    logger.info(
      {
        operation: "restore_orphan_sweep",
        archivedFiles: noGrace.size,
        quarantined: results.reduce((n, r) => n + r.quarantined, 0),
      },
      "Restored files no row references were moved to the quarantine"
    );
    return results;
  } catch (error) {
    logger.warn(
      {
        operation: "restore_orphan_sweep_failed",
        error: { message: error instanceof Error ? error.message : String(error) },
      },
      "Could not sweep the restored files; the hourly orphan sweep will"
    );
    return [];
  }
}

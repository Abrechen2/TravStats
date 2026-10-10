import path from "path";

import { BACKED_UP_UPLOAD_DIRS, UPLOADS_ROOT, type UploadDirName } from "../../config/uploadDirs";
import logger from "../../utils/logger";
import { displayRenditionName } from "../photos/displayRendition";
import { UPLOAD_DIR_POLICIES } from "./uploadDirPolicies";
import {
  QUARANTINE_RETENTION_MS,
  quarantineDirPath,
  quarantineUpload,
  restoreFromQuarantine,
} from "./quarantine";
import { listUploadFiles, unlinkUpload, uploadFileAgeMs } from "./uploadFiles";

/**
 * The orphan sweep, for every upload directory (forgejo#287).
 *
 * It began as the documents' own (forgejo#116) and is that sweep generalised:
 * a file that no row references, and that is older than the grace period, is
 * moved into the quarantine (`quarantine.ts`) — not deleted, because "no row"
 * may only mean the database was restored to an older point — and deleted
 * from there once it has stayed unreferenced for the retention period. It is
 * what finishes an account deletion whose unlink failed, a
 * cascade that removed rows without their bytes (a deleted trip, stay or
 * place), and a request that died between writing a file and its row.
 *
 * The grace period is what keeps an upload in flight: its file is on disk a
 * moment before its row is committed.
 */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const RENDITION_SUFFIX = displayRenditionName("x").slice(1);

/**
 * Is this stored name still wanted? A HEIC original's display copy is wanted
 * exactly as long as its original is.
 */
export function isReferenced(name: string, referenced: ReadonlySet<string>): boolean {
  if (referenced.has(name)) return true;
  return name.endsWith(RENDITION_SUFFIX) && referenced.has(name.slice(0, -RENDITION_SUFFIX.length));
}

export interface SweepOptions {
  /** The uploads root; tests point it at a temporary directory. */
  root?: string;
  /** Epoch ms the ages are measured against. */
  now?: number;
  /** Override for a file's age; null means the file is gone. */
  fileAgeMs?: (dir: UploadDirName, name: string) => Promise<number | null>;
  /**
   * `<dir>/<name>` entries the grace period does not protect — the files a
   * restore just unpacked, which are not uploads in flight.
   */
  noGrace?: ReadonlySet<string>;
  /** Directories to leave out of this run. */
  except?: readonly UploadDirName[];
}

export interface DirSweepResult {
  dir: UploadDirName;
  /** Orphans moved into the quarantine this run. */
  quarantined: number;
  /** Quarantined files a row references again, put back. */
  restored: number;
  /** Quarantined files past `QUARANTINE_RETENTION_MS`, deleted. */
  purged: number;
  failed: number;
}

const QUARANTINE_LOG = {
  quarantined: [
    "orphan_sweep_quarantined",
    "No row references this upload; moved to the quarantine",
  ],
  restored: [
    "orphan_sweep_restored",
    "A row references this upload again; moved back from the quarantine",
  ],
  purged: ["orphan_sweep_purged", "Quarantined upload past its retention period; deleted"],
} as const;

function logMove(kind: keyof typeof QUARANTINE_LOG, dir: UploadDirName, storedName: string): void {
  const [operation, msg] = QUARANTINE_LOG[kind];
  logger.info({ operation, dir, storedName }, msg);
}

/**
 * Sweeps one directory: the quarantine first — back what is referenced again,
 * delete what has outlived its retention — then the live files, moving every
 * orphan past its grace period into the quarantine. Throws only when the
 * directory or its references cannot be read at all — `sweepOrphanUploads`
 * keeps that to the one directory.
 */
export async function sweepUploadDir(
  dir: UploadDirName,
  options: SweepOptions = {}
): Promise<DirSweepResult> {
  const result: DirSweepResult = { dir, quarantined: 0, restored: 0, purged: 0, failed: 0 };
  const rule = UPLOAD_DIR_POLICIES[dir].sweep;
  if (rule.kind === "none") return result;

  const root = options.root ?? UPLOADS_ROOT;
  const dirPath = path.join(root, dir);
  const holdPath = quarantineDirPath(root, dir);
  const now = options.now ?? Date.now();
  const ageOf = options.fileAgeMs ?? ((_d, name) => uploadFileAgeMs(dirPath, name, now));

  // Files first, references second: a file written after the listing is not
  // judged at all, and one whose row lands in between is found referenced.
  const onDisk = await listUploadFiles(dirPath);
  const held = await listUploadFiles(holdPath);
  if (onDisk.length === 0 && held.length === 0) return result;
  const referenced = new Set(await rule.referenced());

  for (const name of held) {
    if (isReferenced(name, referenced)) {
      const outcome = await restoreFromQuarantine(root, dir, name);
      if (outcome === "restored") {
        result.restored++;
        logMove("restored", dir, name);
      }
      if (outcome === "failed") result.failed++;
      // A shadowed copy — a live file of that name exists — is redundant and
      // ages out like any other; everything else is done with.
      if (outcome !== "shadowed") continue;
    }
    const heldFor = await uploadFileAgeMs(holdPath, name, now);
    if (heldFor === null || heldFor < QUARANTINE_RETENTION_MS) continue;
    const outcome = await unlinkUpload(holdPath, name, { operation: "orphan_sweep_purge", dir });
    if (outcome === "removed") {
      result.purged++;
      logMove("purged", dir, name);
    }
    if (outcome === "failed") result.failed++;
  }

  for (const name of onDisk) {
    if (isReferenced(name, referenced)) continue;
    if (!options.noGrace?.has(`${dir}/${name}`)) {
      // No age means the file vanished since the listing: nothing to move.
      const age = await ageOf(dir, name);
      if (age === null || age < ORPHAN_GRACE_MS) continue;
    }
    const outcome = await quarantineUpload(root, dir, name, now);
    if (outcome === "quarantined") {
      result.quarantined++;
      logMove("quarantined", dir, name);
    }
    if (outcome === "failed") result.failed++;
  }
  return result;
}

/** Sweeps every upload directory; one that cannot be read does not stop the others. */
export async function sweepOrphanUploads(options: SweepOptions = {}): Promise<DirSweepResult[]> {
  const results: DirSweepResult[] = [];
  for (const dir of BACKED_UP_UPLOAD_DIRS) {
    if (options.except?.includes(dir)) continue;
    try {
      results.push(await sweepUploadDir(dir, options));
    } catch (error) {
      logger.warn(
        {
          operation: "orphan_sweep_dir_failed",
          dir,
          error: { message: error instanceof Error ? error.message : String(error) },
        },
        "Orphan sweep could not read an upload directory; the next run retries"
      );
    }
  }
  const touched = results.filter((r) => r.quarantined + r.restored + r.purged + r.failed > 0);
  if (touched.length > 0) {
    logger.info({ operation: "orphan_sweep", results: touched }, "Orphan sweep moved files");
  }
  return results;
}

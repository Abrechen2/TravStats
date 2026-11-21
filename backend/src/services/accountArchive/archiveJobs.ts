import { randomUUID } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { startJob, type JobView } from "../jobs/jobRegistry";
import { readCatalog, type Db } from "./catalog";
import { writeAccountArchive, type ExportResult } from "./exportArchive";
import { archiveWorkDir } from "./format";
import { importAccountArchive, nonEmptyTables, type ImportResult } from "./importArchive";
import { buildPlan } from "./plan";

/**
 * The account archive as background jobs (forgejo#433): an export or import can run
 * for many minutes, so the request answers with a job id the page polls. One run
 * per account at a time. A finished export waits in the work directory for its
 * download and is removed after `EXPORT_TTL_MS`; a restart forgets the handle, and
 * the next export sweeps the orphaned file.
 */

export const EXPORT_TTL_MS = 6 * 60 * 60 * 1000;

interface StoredExport {
  userId: string;
  path: string;
  filename: string;
  createdAt: number;
}

const exportsById = new Map<string, StoredExport>();
const running = new Set<string>();
/** Accounts whose deletion began while an export of theirs may still be running. */
const cancelledExports = new Set<string>();

/**
 * Marks the account's running export cancelled: the job re-checks this flag (and
 * the account row) right before it registers its ZIP, so an archive finishing
 * AFTER a deletion cannot resurrect the deleted data.
 */
export function cancelAccountExports(userId: string): void {
  if (running.has(userId)) cancelledExports.add(userId);
}

/** The account still exists and no deletion is reserved on it. */
async function accountIsLive(userId: string): Promise<boolean> {
  const row = await prisma.user.findFirst({
    where: { id: userId, deletionStartedAt: null },
    select: { id: true },
  });
  return row !== null;
}

function claim(userId: string): void {
  if (running.has(userId)) {
    throw new AppError(
      "An account archive is already being built or imported",
      409,
      "ACCOUNT_ARCHIVE_BUSY"
    );
  }
  running.add(userId);
}

async function workDir(): Promise<string> {
  const dir = archiveWorkDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Removes expired exports, and files no handle names that are older than the TTL. */
export async function sweepExports(now = Date.now()): Promise<void> {
  for (const [id, stored] of exportsById) {
    if (now - stored.createdAt > EXPORT_TTL_MS) {
      exportsById.delete(id);
      await fsp.rm(stored.path, { force: true });
    }
  }
  const dir = archiveWorkDir();
  const known = new Set([...exportsById.values()].map((e) => path.basename(e.path)));
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (known.has(name)) continue;
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (stat && now - stat.mtimeMs > EXPORT_TTL_MS)
      await fsp.rm(path.join(dir, name), { force: true });
  }
}

/** A deleted account's finished archives go with it: they hold every file it had. */
export async function deleteAccountArchives(userId: string): Promise<void> {
  cancelAccountExports(userId);
  for (const [id, stored] of exportsById) {
    if (stored.userId !== userId) continue;
    exportsById.delete(id);
    await fsp.rm(stored.path, { force: true });
  }
}

export interface ExportJobResult extends ExportResult {
  exportId: string;
  filename: string;
}

export function startAccountExport(userId: string, username: string): JobView {
  claim(userId);
  cancelledExports.delete(userId);
  try {
    return startJob("accountArchive.export", userId, async (report): Promise<ExportJobResult> => {
      try {
        const dir = await workDir();
        await sweepExports();
        const exportId = randomUUID();
        const target = path.join(dir, `${exportId}.zip`);
        let registered = false;
        try {
          const result = await writeAccountArchive(userId, target, report);
          if (cancelledExports.has(userId) || !(await accountIsLive(userId))) {
            throw new AppError("The account was deleted while its archive was being built", 409);
          }
          // No await between the last check and the registration.
          if (cancelledExports.has(userId)) throw new AppError("Export cancelled", 409);
          const day = new Date().toISOString().slice(0, 10);
          const safeName = username.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "account";
          const filename = `travstats-account-${safeName}-${day}.zip`;
          exportsById.set(exportId, { userId, path: target, filename, createdAt: Date.now() });
          registered = true;
          return { ...result, exportId, filename };
        } finally {
          if (!registered) await fsp.rm(target, { force: true });
        }
      } finally {
        running.delete(userId);
        cancelledExports.delete(userId);
      }
    });
  } catch (err) {
    running.delete(userId);
    throw err;
  }
}

/** The finished export, when it exists, has not expired and belongs to `userId`. */
export function findExport(exportId: string, userId: string): StoredExport | null {
  const stored = exportsById.get(exportId);
  if (!stored || stored.userId !== userId) return null;
  if (Date.now() - stored.createdAt > EXPORT_TTL_MS || !fs.existsSync(stored.path)) return null;
  return stored;
}

export function startAccountImport(userId: string, uploaded: string): JobView {
  try {
    claim(userId);
  } catch (err) {
    void fsp.rm(uploaded, { force: true });
    throw err;
  }
  try {
    return startJob("accountArchive.import", userId, async (report): Promise<ImportResult> => {
      try {
        const result = await importAccountArchive(uploaded, userId, report);
        logger.info({
          operation: "account_archive_imported",
          userId,
          archiveId: result.archiveId,
          files: result.files,
          alreadyImported: result.alreadyImported,
        });
        return result;
      } finally {
        running.delete(userId);
        await fsp.rm(uploaded, { force: true });
      }
    });
  } catch (err) {
    running.delete(userId);
    void fsp.rm(uploaded, { force: true });
    throw err;
  }
}

/** Whether the account can take an import, and which tables already hold its data. */
export async function importReadiness(userId: string): Promise<{ empty: boolean; busy: boolean }> {
  const plan = buildPlan(await readCatalog(prisma as unknown as Db));
  const tables = await nonEmptyTables(prisma as unknown as Db, plan, userId);
  return { empty: tables.length === 0, busy: running.has(userId) };
}

/** The directory uploads are spooled into before their job reads them, created 0700. */
export const ensureWorkDir = workDir;

/** Test seam. */
export function __resetArchiveJobs(): void {
  exportsById.clear();
  running.clear();
  cancelledExports.clear();
}

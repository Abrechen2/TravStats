import { randomBytes } from "crypto";

import { UPLOADS_ROOT } from "../../config/uploadDirs";
import { prisma } from "../../db";
import { Prisma, type PrismaClient } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { readCatalog, quoteIdent, type Db } from "./catalog";
import {
  ACCOUNT_ENTRY,
  accountProfileSchema,
  archiveMaxBytes,
  tableEntryName,
  type AccountProfile,
} from "./format";
import {
  applyDeferred,
  insertTable,
  resolveCatalogue,
  type DeferredUpdate,
  type KeyMaps,
} from "./importRows";
import { readContents, verifyChecksums, type ArchiveContents } from "./importValidate";
import { buildPlan, selectionWhere, type ArchivePlan } from "./plan";
import { Remapper } from "./remap";
import { removeFiles, writeFiles, type WrittenFile } from "./importFiles";
import { USER_SETTINGS_SECRETS } from "./tablePolicy";
import { ArchiveReader, invalidArchive } from "./zipReader";
import { paceAfter, sleep as realSleep, type Sleep } from "../travtrack/imports/importPacing";
import { FairSlot, importWriteSlot, SLICE_BATCHES } from "../travtrack/imports/writeSlot";
import { raiseStatementTimeout } from "../db/sessionTimeouts";
import logger from "../../utils/logger";

/**
 * Imports an account archive into an EMPTY account (forgejo#433).
 *
 * All or nothing: the archive is checked in full first (manifest, sizes, every
 * entry's sha256, every table and column known here), then the files are written
 * under new names and the rows inserted. Any failure removes the rows and the
 * files already written, so a failed import leaves the account exactly as empty
 * as it was. A second import of the same archive answers with the first one's
 * outcome (same account) or is refused (another account).
 *
 * Paced, not one transaction (perf audit 2026-11, item 5). The rows used to go
 * in through ONE interactive transaction of up to six hours: it held the xmin
 * horizon (no vacuum anywhere) for the whole restore and wrote unpaced, the
 * pattern that made prod unusable during the 24.11 Timeline import. Now every
 * batch commits on its own, the restore pauses after each in proportion to
 * what it cost (`paceAfter`), and it holds the import write slot so it never
 * writes at the same time as a file import. "All or nothing" is kept by
 * compensation instead: the account was empty when the restore began
 * (`nonEmptyTables`), so undoing it deletes the account's rows in every table
 * the archive writes and puts back the rows it replaced. The archive id is
 * recorded first with `inProgress`, so a restore interrupted by a crash is
 * undone and run again by the next attempt instead of being reported done.
 */

export interface ImportResult {
  archiveId: string;
  tables: Record<string, number>;
  files: number;
  alreadyImported: boolean;
  /** Rows refused per table: their file, parent or catalogue row was not there. */
  skipped: Record<string, number>;
  /** Catalogue references (port, airport, ship, ...) with no match here: left empty. */
  unmatched: number;
  /** Files whose bytes the upload path would not have accepted. */
  refusedFiles: number;
}

type ReportProgress = (done: number, total: number) => void;

/** The closing transaction: the account's profile, kept secrets and the outcome. */
const FINISH_TX_TIMEOUT_MS = 60_000;
/** Archive ids being restored by THIS process; a marker without one was left by a crash. */
const restoresRunning = new Set<string>();
/** Undoing a restore deletes everything it wrote, 870k TravTrack points on the largest account. */
const LONG_UNDO_TX_TIMEOUT_MS = 30 * 60_000;
/** account.json holds a handful of profile fields. */
export const PROFILE_MAX_BYTES = 64 * 1024;

/**
 * Rows every account has from its first sign-in (the settings row) or from a first
 * visit (TravTrack's place settings). They do not make an account "not empty"; the
 * archive's own rows replace them.
 */
export const REPLACED_ON_IMPORT = ["user_settings", "travtrack_place_settings"] as const;

export interface ImportOptions {
  uploadsRoot?: string;
  maxBytes?: number;
  /** The database to write; tests pass a second one. */
  client?: PrismaClient;
  /** Test seam: called after the given number of inserted rows. */
  failAfterRows?: number;
  /** Test seam: the pause between batches. */
  sleep?: Sleep;
  /** Test seam: the instance's write slot. */
  slot?: FairSlot;
}

/** The tables in which the account already has rows that an import would collide with. */
export async function nonEmptyTables(db: Db, plan: ArchivePlan, userId: string): Promise<string[]> {
  const found: string[] = [];
  for (const p of plan.tables) {
    if (p.policy.kind !== "owner") continue;
    if ((REPLACED_ON_IMPORT as readonly string[]).includes(p.table.name)) continue;
    const [row] = await db.$queryRawUnsafe<Array<{ any: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM ${quoteIdent(p.table.name)} WHERE ${quoteIdent(p.policy.column)} = $1) AS any`,
      userId
    );
    if (row.any) found.push(p.table.name);
  }
  return found;
}

function notEmpty(): AppError {
  return new AppError("The account already holds data", 409, "ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY");
}

async function readProfile(reader: ArchiveReader): Promise<AccountProfile | null> {
  if (!reader.entries.has(ACCOUNT_ENTRY)) return null;
  const parsed = accountProfileSchema.safeParse(
    await reader.readJson(ACCOUNT_ENTRY, PROFILE_MAX_BYTES)
  );
  if (!parsed.success) throw invalidArchive("account.json is malformed");
  return parsed.data;
}

/** Collects the archive's ids, so text naming them is rewritten as well. */
async function learnIds(
  reader: ArchiveReader,
  plan: ArchivePlan,
  contents: ArchiveContents,
  remap: Remapper
) {
  for (const table of contents.dataTables.keys()) {
    const p = plan.byName.get(table)!;
    if (!p.idColumn || p.policy.bulk) continue;
    for await (const row of reader.jsonLines(tableEntryName("data", table))) {
      const id = row[p.idColumn];
      if (typeof id !== "string") throw invalidArchive(`${table} row without an id`);
      remap.knowId(id);
    }
  }
}

export async function importAccountArchive(
  file: string,
  targetUserId: string,
  report: ReportProgress = () => {},
  options: ImportOptions = {}
): Promise<ImportResult> {
  const root = options.uploadsRoot ?? UPLOADS_ROOT;
  const client = options.client ?? (prisma as unknown as PrismaClient);
  const reader = await ArchiveReader.open(file);
  const written: WrittenFile[] = [];
  try {
    const plan = buildPlan(await readCatalog(client as unknown as Db));
    const contents = await readContents(reader, plan, options.maxBytes ?? archiveMaxBytes());
    const { manifest } = contents;

    const earlier = await client.accountArchiveImport.findUnique({
      where: { archiveId: manifest.archiveId },
    });
    const interrupted =
      earlier !== null &&
      (earlier.counts as { inProgress?: boolean } | null)?.inProgress === true &&
      earlier.userId === targetUserId;
    if (interrupted && restoresRunning.has(manifest.archiveId)) {
      throw new AppError(
        "This archive is being imported already",
        409,
        "ACCOUNT_ARCHIVE_ALREADY_IMPORTED"
      );
    }
    if (interrupted) {
      // A crash ended the previous attempt half-way: undo it, then start afresh.
      logger.warn({
        operation: "account_archive_import_interrupted",
        message: "An earlier restore of this archive was interrupted; undoing it before retrying",
        context: { archiveId: manifest.archiveId, userId: targetUserId },
      });
      await undoImport(client, plan, targetUserId, null);
      await client.accountArchiveImport.delete({ where: { archiveId: manifest.archiveId } });
    } else if (earlier) {
      if (earlier.userId !== targetUserId) {
        throw new AppError(
          "This archive was already imported into another account",
          409,
          "ACCOUNT_ARCHIVE_ALREADY_IMPORTED"
        );
      }
      const counts = earlier.counts as Partial<Omit<ImportResult, "archiveId" | "alreadyImported">>;
      return {
        archiveId: manifest.archiveId,
        tables: counts.tables ?? {},
        files: counts.files ?? 0,
        alreadyImported: true,
        skipped: counts.skipped ?? {},
        unmatched: counts.unmatched ?? 0,
        refusedFiles: counts.refusedFiles ?? 0,
      };
    }
    if ((await nonEmptyTables(client as unknown as Db, plan, targetUserId)).length > 0)
      throw notEmpty();

    const rowsTotal = [...contents.dataTables.values()].reduce((a, b) => a + b, 0);
    const total = manifest.entries.length + contents.files.length + rowsTotal;
    let done = 0;
    const tick = () => {
      done += 1;
      if (done % 500 === 0 || done === total) report(done, total);
    };
    report(0, total);
    await verifyChecksums(reader, manifest, tick);

    const profile = await readProfile(reader);
    const remap = new Remapper(
      randomBytes(16).toString("hex"),
      manifest.sourceUserId,
      targetUserId
    );
    await learnIds(reader, plan, contents, remap);
    const { verdicts, refused } = await writeFiles(reader, contents, remap, root, written, tick);
    const outcome = { skipped: {} as Record<string, number>, unmatched: 0 };

    const snapshot = await snapshotReplaced(client as unknown as Db, contents, targetUserId);
    // Committed at once: a concurrent second import of this archive hits the
    // unique id (P2002) and is refused; a crash leaves `inProgress` behind.
    await client.accountArchiveImport.create({
      data: {
        archiveId: manifest.archiveId,
        userId: targetUserId,
        sourceServerVersion: manifest.serverVersion,
        formatVersion: manifest.formatVersion,
        counts: { inProgress: true },
      },
    });
    restoresRunning.add(manifest.archiveId);
    const slot = options.slot ?? importWriteSlot;
    let tables: Record<string, number>;
    try {
      await slot.acquire(targetUserId);
      try {
        tables = await restoreRows(client, {
          plan,
          reader,
          contents,
          remap,
          verdicts,
          refused,
          profile,
          outcome,
          targetUserId,
          archiveId: manifest.archiveId,
          tick,
          afterWrite: restorePacer(slot, targetUserId, options.sleep ?? realSleep),
          failAfterRows: options.failAfterRows,
        });
      } finally {
        slot.release();
      }
    } catch (err) {
      await undoImport(client, plan, targetUserId, snapshot).catch((undoErr: unknown) => {
        logger.error({
          operation: "account_archive_import_undo_failed",
          message: "A failed restore could not be undone; the next attempt will retry the undo",
          context: { archiveId: manifest.archiveId, userId: targetUserId },
          error: undoErr instanceof Error ? undoErr.message : String(undoErr),
        });
        throw undoErr;
      });
      await client.accountArchiveImport.delete({ where: { archiveId: manifest.archiveId } });
      throw err;
    } finally {
      restoresRunning.delete(manifest.archiveId);
    }
    report(total, total);
    return {
      archiveId: manifest.archiveId,
      tables,
      files: verdicts.size,
      alreadyImported: false,
      skipped: outcome.skipped,
      unmatched: outcome.unmatched,
      refusedFiles: refused,
    };
  } catch (err) {
    await removeFiles(written);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(
        "This archive is being imported already",
        409,
        "ACCOUNT_ARCHIVE_ALREADY_IMPORTED"
      );
    }
    throw err;
  } finally {
    reader.close();
  }
}

interface RestoreInput {
  plan: ArchivePlan;
  reader: ArchiveReader;
  contents: ArchiveContents;
  remap: Remapper;
  verdicts: Awaited<ReturnType<typeof writeFiles>>["verdicts"];
  refused: number;
  profile: AccountProfile | null;
  outcome: { skipped: Record<string, number>; unmatched: number };
  targetUserId: string;
  archiveId: string;
  tick: () => void;
  afterWrite: () => Promise<void>;
  failAfterRows?: number;
}

/**
 * The pause after a batch, as long as the batch took (`paceAfter`), and every
 * `SLICE_BATCHES` batches the write slot is offered to a waiting file import.
 */
export function restorePacer(
  slot: FairSlot,
  userId: string,
  wait: Sleep,
  now: () => number = () => performance.now()
): () => Promise<void> {
  let since = now();
  let batches = 0;
  return async () => {
    await wait(paceAfter(now() - since));
    batches += 1;
    if (batches >= SLICE_BATCHES) {
      batches = 0;
      await slot.yieldTurn(userId);
    }
    since = now();
  };
}

/** Inserts the rows table by table, each batch its own commit; returns rows per table. */
async function restoreRows(
  client: PrismaClient,
  input: RestoreInput
): Promise<Record<string, number>> {
  const { plan, reader, contents, remap, verdicts, outcome, targetUserId } = input;
  const db = client as unknown as Db;
  if ((await nonEmptyTables(db, plan, targetUserId)).length > 0) throw notEmpty();
  const keyMaps: KeyMaps = await resolveCatalogue(db, reader, plan, contents.catalogueTables);
  const deferred: DeferredUpdate[] = [];
  const skipped = new Set<string>();
  const ctx = { plan, remap, keyMaps, deferred, verdicts, skipped, report: outcome };
  const counts: Record<string, number> = {};
  let keptSecrets: Record<string, unknown> | null = null;
  let inserted = 0;
  const onRow = () => {
    inserted += 1;
    if (input.failAfterRows !== undefined && inserted > input.failAfterRows) {
      throw new Error("account archive import: injected failure");
    }
    input.tick();
  };
  for (const p of plan.tables) {
    if (!contents.dataTables.has(p.table.name)) continue;
    if ((REPLACED_ON_IMPORT as readonly string[]).includes(p.table.name)) {
      // One row each: cleared and written in one short transaction, so the
      // account is never left without its settings row in between.
      counts[p.table.name] = await client.$transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const kept = await clearReplaced(txDb, p.table.name, targetUserId);
        if (kept) keptSecrets = kept;
        return insertTable(txDb, reader, ctx, p, onRow);
      });
      continue;
    }
    counts[p.table.name] = await insertTable(db, reader, ctx, p, onRow, input.afterWrite);
  }
  await applyDeferred(db, deferred, skipped, input.afterWrite);
  await client.$transaction(
    async (tx) => {
      const txDb = tx as unknown as Db;
      await restoreSecrets(txDb, keptSecrets, targetUserId);
      if (input.profile) await applyProfile(txDb, input.profile, targetUserId);
      await tx.accountArchiveImport.update({
        where: { archiveId: input.archiveId },
        data: {
          counts: {
            tables: counts,
            files: verdicts.size,
            skipped: outcome.skipped,
            unmatched: outcome.unmatched,
            refusedFiles: input.refused,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: FINISH_TX_TIMEOUT_MS }
  );
  return counts;
}

/** The target's own rows of the replaced tables, to put back when the restore is undone. */
async function snapshotReplaced(
  db: Db,
  contents: ArchiveContents,
  userId: string
): Promise<Map<string, unknown[]>> {
  const out = new Map<string, unknown[]>();
  for (const table of REPLACED_ON_IMPORT) {
    if (!contents.dataTables.has(table)) continue;
    const rows = await db.$queryRawUnsafe<Array<{ j: unknown }>>(
      `SELECT row_to_json(t)::text AS j FROM ${quoteIdent(table)} t WHERE user_id = $1`,
      userId
    );
    out.set(
      table,
      rows.map((r) => JSON.parse(r.j as string))
    );
  }
  return out;
}

/**
 * Undoes a restore: the account was empty when it began, so its rows in every
 * table the archive writes are the restore's. Late and cycle columns are
 * cleared first, then the tables are emptied children first, then the replaced
 * rows are put back. One transaction, with the restore's raised statement
 * timeout: the delete runs through everything the restore wrote.
 */
async function undoImport(
  client: PrismaClient,
  plan: ArchivePlan,
  userId: string,
  snapshot: Map<string, unknown[]> | null
): Promise<void> {
  await client.$transaction(
    async (tx) => {
      const db = tx as unknown as Db;
      await raiseStatementTimeout(tx, "archiveRestore");
      for (const p of plan.tables) {
        const late = [...(plan.deferred.get(p.table.name) ?? []), ...(p.policy.late ?? [])].filter(
          (c) => !p.table.columns.find((x) => x.name === c)?.notNull
        );
        if (late.length === 0) continue;
        const set = late.map((c) => `${quoteIdent(c)} = NULL`).join(", ");
        await db.$executeRawUnsafe(
          `UPDATE ${quoteIdent(p.table.name)} t0 SET ${set} WHERE ${selectionWhere(plan, p.table.name)}`,
          userId
        );
      }
      for (const p of [...plan.tables].reverse()) {
        await db.$executeRawUnsafe(
          `DELETE FROM ${quoteIdent(p.table.name)} t0 WHERE ${selectionWhere(plan, p.table.name)}`,
          userId
        );
      }
      for (const [table, rows] of snapshot ?? []) {
        if (rows.length === 0) continue;
        await db.$executeRawUnsafe(
          `INSERT INTO ${quoteIdent(table)} SELECT * FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json)`,
          JSON.stringify(rows)
        );
      }
    },
    { timeout: LONG_UNDO_TX_TIMEOUT_MS }
  );
}

/**
 * Removes the target's own row of a replaced table, keeping the target's stored
 * provider keys (returned for `user_settings`): those never travel, and an
 * account that had entered some keeps them.
 */
async function clearReplaced(
  db: Db,
  table: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  let secrets: Record<string, unknown> | null = null;
  if (table === "user_settings") {
    const cols = [...USER_SETTINGS_SECRETS, ...Object.values(CREDENTIAL_ENDPOINTS)]
      .map(quoteIdent)
      .join(", ");
    const [row] = await db.$queryRawUnsafe<Array<{ j: Record<string, unknown> }>>(
      `SELECT row_to_json(x) AS j FROM (SELECT ${cols} FROM user_settings WHERE user_id = $1) x`,
      userId
    );
    secrets = row?.j ?? null;
  }
  await db.$executeRawUnsafe(`DELETE FROM ${quoteIdent(table)} WHERE user_id = $1`, userId);
  return secrets;
}

/**
 * A stored key travels with the endpoint it was entered for: where the target kept
 * a key of its own, its base URL is kept too, so an archive cannot point the
 * target's credential at a server of the archive's choosing.
 */
const CREDENTIAL_ENDPOINTS: Readonly<Record<string, string>> = {
  immich_api_key: "immich_base_url",
  photoprism_token: "photoprism_base_url",
  dawarich_api_key: "dawarich_base_url",
};

async function restoreSecrets(
  db: Db,
  kept: Record<string, unknown> | null,
  userId: string
): Promise<void> {
  if (!kept) return;
  const cols = Object.keys(kept).filter((c) =>
    (USER_SETTINGS_SECRETS as readonly string[]).includes(c)
  );
  for (const [key, endpoint] of Object.entries(CREDENTIAL_ENDPOINTS)) {
    if (kept[key] !== null && kept[key] !== undefined) cols.push(endpoint);
  }
  if (cols.length === 0) return;
  const list = cols.map(quoteIdent).join(", ");
  await db.$executeRawUnsafe(
    `UPDATE user_settings s SET (${list}) = (SELECT ${list} FROM json_populate_record(NULL::user_settings, $1::json))
      WHERE s.user_id = $2`,
    JSON.stringify(kept),
    userId
  );
}

/** Names and reminders move; a value the target account already set is kept. */
async function applyProfile(db: Db, profile: AccountProfile, userId: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE users SET first_name = COALESCE(first_name, $2), last_name = COALESCE(last_name, $3),
            birthdate = COALESCE(birthdate, $4::timestamp), notification_email = COALESCE(notification_email, $5),
            notify_before_24h = $6, notify_before_2h = $7
      WHERE id = $1`,
    userId,
    profile.firstName,
    profile.lastName,
    profile.birthdate,
    profile.notificationEmail,
    profile.notifyBefore24h,
    profile.notifyBefore2h
  );
}

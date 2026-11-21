import { createHash, randomBytes } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

import { UPLOADS_ROOT } from "../../config/uploadDirs";
import { prisma } from "../../db";
import { Prisma, type PrismaClient } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
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
import { buildPlan, type ArchivePlan } from "./plan";
import { importedFileName, Remapper } from "./remap";
import { USER_SETTINGS_SECRETS } from "./tablePolicy";
import { ArchiveReader, invalidArchive } from "./zipReader";

/**
 * Imports an account archive into an EMPTY account (forgejo#433).
 *
 * All or nothing: the archive is checked in full first (manifest, sizes, every
 * entry's sha256, every table and column known here), then the files are written
 * under new names and the rows inserted in ONE transaction. Any failure rolls the
 * rows back and removes the files already written, so a failed import leaves the
 * account exactly as empty as it was. The archive id is recorded in the same
 * transaction: a second import of the same archive answers with the first one's
 * outcome (same account) or is refused (another account).
 */

export interface ImportResult {
  archiveId: string;
  tables: Record<string, number>;
  files: number;
  alreadyImported: boolean;
}

type ReportProgress = (done: number, total: number) => void;

const IMPORT_TX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const PROFILE_MAX_BYTES = 1024 * 1024;

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
  /** Test seam: called after the given number of inserted rows, inside the transaction. */
  failAfterRows?: number;
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

interface WrittenFile {
  path: string;
}

async function writeFiles(
  reader: ArchiveReader,
  contents: ArchiveContents,
  remap: Remapper,
  root: string,
  written: WrittenFile[],
  tick: () => void
): Promise<void> {
  const choosePrefix = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const prefix = `a${randomBytes(4).toString("hex")}`;
      const clashes = await Promise.all(
        contents.files.map((f) =>
          fsp
            .access(
              path.join(
                root,
                f.dir,
                importedFileName(f.dir, f.name, prefix, remap.targetUserId, remap.sourceUserId)
              )
            )
            .then(() => true)
            .catch(() => false)
        )
      );
      if (!clashes.some(Boolean)) return prefix;
    }
    throw new AppError("Could not choose free file names", 500, "ACCOUNT_ARCHIVE_INVALID");
  };
  const prefix = await choosePrefix();
  for (const file of contents.files) {
    const newName = importedFileName(
      file.dir,
      file.name,
      prefix,
      remap.targetUserId,
      remap.sourceUserId
    );
    remap.setFile(file.name, newName);
    const dir = path.join(root, file.dir);
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, newName);
    const hash = createHash("sha256");
    written.push({ path: target });
    await pipeline(
      await reader.stream(file.entry),
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      fs.createWriteStream(target, { flags: "wx", mode: 0o644 })
    );
    if (hash.digest("hex") !== file.sha256) {
      throw new AppError(
        `${file.entry} does not match its checksum`,
        422,
        "ACCOUNT_ARCHIVE_CHECKSUM"
      );
    }
    tick();
  }
}

async function removeFiles(written: readonly WrittenFile[]): Promise<void> {
  for (const file of written) {
    await fsp.rm(file.path, { force: true }).catch((err: unknown) => {
      logger.warn({
        operation: "account_archive_import_cleanup_failed",
        file: path.basename(file.path),
        error: String(err),
      });
    });
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
    if (earlier) {
      if (earlier.userId !== targetUserId) {
        throw new AppError(
          "This archive was already imported into another account",
          409,
          "ACCOUNT_ARCHIVE_ALREADY_IMPORTED"
        );
      }
      const counts = earlier.counts as { tables?: Record<string, number>; files?: number };
      return {
        archiveId: manifest.archiveId,
        tables: counts.tables ?? {},
        files: counts.files ?? 0,
        alreadyImported: true,
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
    await writeFiles(reader, contents, remap, root, written, tick);

    const tables = await client.$transaction(
      async (tx) => {
        const db = tx as unknown as Db;
        await tx.accountArchiveImport.create({
          data: {
            archiveId: manifest.archiveId,
            userId: targetUserId,
            sourceServerVersion: manifest.serverVersion,
            formatVersion: manifest.formatVersion,
            counts: {},
          },
        });
        if ((await nonEmptyTables(db, plan, targetUserId)).length > 0) throw notEmpty();
        const keptSecrets = await clearReplaced(db, contents, targetUserId);
        const keyMaps: KeyMaps = await resolveCatalogue(
          db,
          reader,
          plan,
          contents.catalogueTables,
          remap
        );
        const deferred: DeferredUpdate[] = [];
        const ctx = { plan, remap, keyMaps, deferred };
        const counts: Record<string, number> = {};
        let inserted = 0;
        for (const p of plan.tables) {
          if (!contents.dataTables.has(p.table.name)) continue;
          counts[p.table.name] = await insertTable(db, reader, ctx, p, () => {
            inserted += 1;
            if (options.failAfterRows !== undefined && inserted > options.failAfterRows) {
              throw new Error("account archive import: injected failure");
            }
            tick();
          });
        }
        await applyDeferred(db, deferred);
        await restoreSecrets(db, keptSecrets, targetUserId);
        if (profile) await applyProfile(db, profile, targetUserId);
        await tx.accountArchiveImport.update({
          where: { archiveId: manifest.archiveId },
          data: {
            counts: {
              tables: counts,
              files: contents.files.length,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return counts;
      },
      { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: 30_000 }
    );
    report(total, total);
    return {
      archiveId: manifest.archiveId,
      tables,
      files: contents.files.length,
      alreadyImported: false,
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

/**
 * Removes the target's own rows of the replaced tables that the archive brings,
 * keeping the target's stored provider keys: those never travel, and an account
 * that had entered some keeps them.
 */
async function clearReplaced(
  db: Db,
  contents: ArchiveContents,
  userId: string
): Promise<Record<string, unknown> | null> {
  let secrets: Record<string, unknown> | null = null;
  for (const table of REPLACED_ON_IMPORT) {
    if (!contents.dataTables.has(table)) continue;
    if (table === "user_settings") {
      const cols = USER_SETTINGS_SECRETS.map(quoteIdent).join(", ");
      const [row] = await db.$queryRawUnsafe<Array<{ j: Record<string, unknown> }>>(
        `SELECT row_to_json(x) AS j FROM (SELECT ${cols} FROM user_settings WHERE user_id = $1) x`,
        userId
      );
      secrets = row?.j ?? null;
    }
    await db.$executeRawUnsafe(`DELETE FROM ${quoteIdent(table)} WHERE user_id = $1`, userId);
  }
  return secrets;
}

async function restoreSecrets(
  db: Db,
  secrets: Record<string, unknown> | null,
  userId: string
): Promise<void> {
  if (!secrets) return;
  const cols = Object.keys(secrets).filter((c) =>
    (USER_SETTINGS_SECRETS as readonly string[]).includes(c)
  );
  if (cols.length === 0) return;
  const list = cols.map(quoteIdent).join(", ");
  await db.$executeRawUnsafe(
    `UPDATE user_settings s SET (${list}) = (SELECT ${list} FROM json_populate_record(NULL::user_settings, $1::json))
      WHERE s.user_id = $2`,
    JSON.stringify(secrets),
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

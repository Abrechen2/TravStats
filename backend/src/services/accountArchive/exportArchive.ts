import archiver from "archiver";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";

import { BACKED_UP_UPLOAD_DIRS, UPLOADS_ROOT } from "../../config/uploadDirs";
import { prisma } from "../../db";
import type { PrismaClient } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { buildVersion } from "../../utils/version";
import { UPLOAD_DIR_POLICIES } from "../files/uploadDirPolicies";
import { displayRenditionName } from "../photos/displayRendition";
import { readCatalog, quoteIdent, type Db } from "./catalog";
import { transformForExport } from "./exportTransforms";
import {
  ACCOUNT_ENTRY,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  archiveMaxBytes,
  fileEntryName,
  isSafeFileName,
  MANIFEST_ENTRY,
  tableEntryName,
  type AccountProfile,
  type Manifest,
  type ManifestEntry,
} from "./format";
import { ArchivePlanError, buildPlan, selectionWhere, type ArchivePlan } from "./plan";
import { readRows } from "./rowReader";
import { TABLE_POLICY } from "./tablePolicy";

/**
 * Writes one account as a ZIP (forgejo#433, format in `format.ts`). Rows are read
 * inside one REPEATABLE READ transaction, so the archive is one consistent moment
 * of the account, and streamed into the ZIP page by page; files are streamed from
 * disk. Nothing holds the whole archive in memory.
 */

export interface ExportResult {
  archiveId: string;
  bytes: number;
  tables: Record<string, number>;
  files: number;
  /** Files a row names that were not on disk: the row travels, the bytes cannot. */
  missingFiles: number;
}

type ReportProgress = (done: number, total: number) => void;

const EXPORT_TX_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function tooLarge(): AppError {
  return new AppError("The account archive is too large", 413, "ACCOUNT_ARCHIVE_TOO_LARGE");
}

class EntryWriter {
  readonly entries: ManifestEntry[] = [];
  private total = 0;

  constructor(
    private readonly archive: archiver.Archiver,
    private readonly maxBytes: number
  ) {}

  /** Appends one entry and waits until the ZIP has taken all of it. */
  async add(
    name: string,
    source: AsyncIterable<Buffer>,
    rows?: number | (() => number)
  ): Promise<void> {
    const hash = createHash("sha256");
    let bytes = 0;
    const counted = Readable.from(
      async function* (this: EntryWriter) {
        for await (const chunk of source) {
          bytes += chunk.length;
          this.total += chunk.length;
          if (this.total > this.maxBytes) throw tooLarge();
          hash.update(chunk);
          yield chunk;
        }
      }.call(this)
    );
    await new Promise<void>((resolve, reject) => {
      const onEntry = (entry: archiver.EntryData) => {
        if (entry.name !== name) return;
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.archive.off("entry", onEntry);
        this.archive.off("error", onError);
      };
      this.archive.on("entry", onEntry);
      this.archive.on("error", onError);
      counted.on("error", onError);
      this.archive.append(counted, { name });
    });
    const rowCount = typeof rows === "function" ? rows() : rows;
    this.entries.push({
      name,
      bytes,
      sha256: hash.digest("hex"),
      ...(rowCount === undefined ? {} : { rows: rowCount }),
    });
  }
}

async function* jsonLines(
  rows: AsyncIterable<Record<string, unknown>>,
  counter: { rows: number },
  onRow: () => void
): AsyncGenerator<Buffer> {
  for await (const row of rows) {
    counter.rows += 1;
    onRow();
    yield Buffer.from(`${JSON.stringify(row)}\n`);
  }
}

async function* oneBuffer(value: unknown): AsyncGenerator<Buffer> {
  yield Buffer.from(JSON.stringify(value, null, 2));
}

interface AccountFile {
  dir: string;
  name: string;
  size: number;
}

/** The files the account owns, by the same per-directory rules the account deletion uses. */
async function collectFiles(
  userId: string,
  root: string
): Promise<{ files: AccountFile[]; missing: number }> {
  const files: AccountFile[] = [];
  let missing = 0;
  for (const dir of BACKED_UP_UPLOAD_DIRS) {
    const rule = UPLOAD_DIR_POLICIES[dir].account;
    if (rule.kind === "none") continue;
    const dirPath = path.join(root, dir);
    const names = new Set((await rule.namesOf(userId, dirPath)).filter(isSafeFileName));
    for (const name of [...names]) names.add(displayRenditionName(name));
    for (const name of [...names].sort()) {
      const stat = await fsp.stat(path.join(dirPath, name)).catch(() => null);
      if (stat?.isFile()) files.push({ dir, name, size: stat.size });
      else if (!name.endsWith(displayRenditionName(""))) missing += 1;
    }
  }
  return { files, missing };
}

async function readProfile(db: Db, userId: string): Promise<AccountProfile> {
  const [user] = await db.$queryRawUnsafe<
    Array<{
      username: string;
      first_name: string | null;
      last_name: string | null;
      birthdate: string | null;
      notification_email: string | null;
      notify_before_24h: boolean;
      notify_before_2h: boolean;
    }>
  >(
    `SELECT username, first_name, last_name, birthdate::text AS birthdate, notification_email,
            notify_before_24h, notify_before_2h FROM users WHERE id = $1`,
    userId
  );
  if (!user) throw new AppError("Account not found", 404, "ACCOUNT_ARCHIVE_NOT_FOUND");
  return {
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    birthdate: user.birthdate,
    notificationEmail: user.notification_email,
    notifyBefore24h: user.notify_before_24h,
    notifyBefore2h: user.notify_before_2h,
  };
}

async function countRows(db: Db, plan: ArchivePlan, userId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const p of plan.tables) {
    const [row] = await db.$queryRawUnsafe<Array<{ n: string }>>(
      `SELECT count(*)::text AS n FROM ${quoteIdent(p.table.name)} t0 WHERE ${selectionWhere(plan, p.table.name)}`,
      userId
    );
    counts.set(p.table.name, Number(row.n));
  }
  return counts;
}

/** Ids of catalogue rows the account's rows point at, per catalogue table. */
async function catalogueRefs(
  db: Db,
  plan: ArchivePlan,
  userId: string
): Promise<Map<string, string[]>> {
  const refs = new Map<string, Set<string>>();
  for (const p of plan.tables) {
    for (const [col, role] of p.fkRoles) {
      if (role.kind !== "catalogue") continue;
      const rows = await db.$queryRawUnsafe<Array<{ v: string }>>(
        `SELECT DISTINCT t0.${quoteIdent(col)}::text AS v FROM ${quoteIdent(p.table.name)} t0
          WHERE ${selectionWhere(plan, p.table.name)} AND t0.${quoteIdent(col)} IS NOT NULL`,
        userId
      );
      const set = refs.get(role.refTable) ?? new Set<string>();
      for (const r of rows) set.add(r.v);
      refs.set(role.refTable, set);
    }
  }
  return new Map([...refs].map(([t, s]) => [t, [...s].sort()]));
}

function catalogueWhere(table: string): string | undefined {
  const policy = TABLE_POLICY[table];
  if (policy?.kind === "catalogue") return policy.spec.where;
  if (policy && (policy.kind === "owner" || policy.kind === "child"))
    return policy.catalogue?.where;
  return undefined;
}

export interface ExportOptions {
  /** The uploads root; tests point it at a temporary directory. */
  uploadsRoot?: string;
  maxBytes?: number;
  /** The database to read; tests pass a second one. */
  client?: PrismaClient;
}

/** Writes the account's archive to `target`. On any failure the partial file is removed. */
export async function writeAccountArchive(
  userId: string,
  target: string,
  report: ReportProgress = () => {},
  options: ExportOptions = {}
): Promise<ExportResult> {
  const root = options.uploadsRoot ?? UPLOADS_ROOT;
  const maxBytes = options.maxBytes ?? archiveMaxBytes();
  const out = fs.createWriteStream(target, { mode: 0o600 });
  const archive = archiver("zip", { zlib: { level: 6 } });
  const closed = new Promise<void>((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
  });
  archive.pipe(out);
  try {
    const client = options.client ?? (prisma as unknown as PrismaClient);
    const result = await client.$transaction(
      (tx) => writeEntries(tx as unknown as Db, archive, userId, root, maxBytes, report),
      { isolationLevel: "RepeatableRead", timeout: EXPORT_TX_TIMEOUT_MS, maxWait: 30_000 }
    );
    await archive.finalize();
    await closed;
    const { size } = await fsp.stat(target);
    return { ...result, bytes: size };
  } catch (err) {
    archive.abort();
    out.destroy();
    await fsp.rm(target, { force: true });
    if (err instanceof ArchivePlanError) {
      throw new AppError(err.message, 500, "ACCOUNT_ARCHIVE_INVALID");
    }
    throw err;
  }
}

async function writeEntries(
  db: Db,
  archive: archiver.Archiver,
  userId: string,
  root: string,
  maxBytes: number,
  report: ReportProgress
): Promise<Omit<ExportResult, "bytes">> {
  const plan = buildPlan(await readCatalog(db));
  if (plan.unclassified.length > 0) {
    throw new ArchivePlanError(`unclassified tables: ${plan.unclassified.join(", ")}`);
  }
  const { files, missing } = await collectFiles(userId, root);
  const fileBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (fileBytes > maxBytes) throw tooLarge();

  const counts = await countRows(db, plan, userId);
  const total = [...counts.values()].reduce((a, b) => a + b, 0) + files.length;
  let done = 0;
  const tick = () => {
    done += 1;
    if (done % 500 === 0 || done === total) report(done, total);
  };
  report(0, total);

  const writer = new EntryWriter(archive, maxBytes);
  await writer.add(ACCOUNT_ENTRY, oneBuffer(await readProfile(db, userId)));

  const tables: Record<string, number> = {};
  for (const p of plan.tables) {
    if (!counts.get(p.table.name)) continue;
    const counter = { rows: 0 };
    const strip = p.policy.strip ?? [];
    const rows = (async function* () {
      for await (const row of readRows(
        db,
        p.table,
        p.readColumns,
        selectionWhere(plan, p.table.name),
        [userId]
      )) {
        yield transformForExport(p.table.name, row, userId, strip);
      }
    })();
    await writer.add(
      tableEntryName("data", p.table.name),
      jsonLines(rows, counter, tick),
      () => counter.rows
    );
    tables[p.table.name] = counter.rows;
  }

  for (const [table, ids] of await catalogueRefs(db, plan, userId)) {
    if (ids.length === 0) continue;
    const info = plan.catalog.get(table)!;
    const pk = quoteIdent(info.primaryKey[0]);
    const extra = catalogueWhere(table);
    const counter = { rows: 0 };
    const where = `t0.${pk}::text = ANY($1::text[])${extra ? ` AND (${extra})` : ""}`;
    const columns = info.columns.filter((c) => !c.generated);
    await writer.add(
      tableEntryName("catalogue", table),
      jsonLines(readRows(db, info, columns, where, [ids]), counter, () => {}),
      () => counter.rows
    );
  }

  for (const [table, policy] of Object.entries(TABLE_POLICY)) {
    if (policy.kind !== "info") continue;
    const info = plan.catalog.get(table);
    if (!info) continue;
    const columns = info.columns.filter(
      (c) => !c.generated && !(policy.omit ?? []).includes(c.name)
    );
    const where = policy.where;
    const [{ n }] = await db.$queryRawUnsafe<Array<{ n: string }>>(
      `SELECT count(*)::text AS n FROM ${quoteIdent(table)} t0 WHERE ${where}`,
      userId
    );
    if (Number(n) === 0) continue;
    const counter = { rows: 0 };
    await writer.add(
      tableEntryName("info", table),
      jsonLines(readRows(db, info, columns, where, [userId]), counter, () => {}),
      () => counter.rows
    );
  }

  for (const file of files) {
    await writer.add(
      fileEntryName(file.dir, file.name),
      fs.createReadStream(path.join(root, file.dir, file.name)) as AsyncIterable<Buffer>
    );
    tick();
  }

  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    archiveId: randomUUID(),
    serverVersion: buildVersion,
    exportedAt: new Date().toISOString(),
    sourceUserId: userId,
    entries: writer.entries,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_ENTRY });
  return { archiveId: manifest.archiveId, tables, files: files.length, missingFiles: missing };
}

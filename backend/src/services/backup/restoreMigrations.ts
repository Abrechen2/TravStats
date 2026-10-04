import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { MIGRATION_MARKER } from "./restorePsql";

/**
 * Which migrations an archive's database lacks, and the SQL that adds them
 * inside the restore's own transaction (forgejo#157).
 *
 * An archive from an older version carries an older schema and the older
 * `_prisma_migrations`. The restore used to replay it and then run `prisma
 * migrate deploy` as a second step — which made the restore two transactions:
 * a migration that failed on the archive's data left the instance on the
 * archive's OLDER schema, newer than nothing and older than its code, with
 * the data it had before gone. Here the pending migrations are appended to
 * the same psql run, after the dump, and recorded exactly as Prisma records
 * them, so the whole restore commits or none of it does.
 *
 * Reading the history from the dump rather than from `metadata.json` is what
 * makes this work for the archives that already exist: none of them carries
 * one, and the dump always has.
 */

/** Where the migrations of THIS version live (src and dist alike sit three levels below backend/). */
export const MIGRATIONS_DIR = path.join(__dirname, "../../../prisma/migrations");

/** Every directory name Prisma has ever written here. Anything else is refused, not quoted. */
const MIGRATION_NAME = /^[0-9]+_[A-Za-z0-9_]+$/;

export interface ArchiveSchema {
  /** Migrations the archive's database finished and did not roll back. */
  applied: string[];
  /** Migrations it started and never finished — a database in Prisma's P3009 state. */
  unfinished: string[];
}

/**
 * The `_prisma_migrations` rows of a plain-format dump, or null when the dump
 * has none. Only the name and the two state columns are read; the dump is
 * streamed, so a large archive costs one sequential read and no memory.
 */
export async function readArchiveSchema(dumpPath: string): Promise<ArchiveSchema | null> {
  const lines = readline.createInterface({
    input: fs.createReadStream(dumpPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  let columns: string[] | null = null;
  const finished = new Set<string>();
  const started = new Set<string>();
  try {
    for await (const line of lines) {
      if (!columns) {
        const header = /^COPY public\._prisma_migrations \(([^)]*)\) FROM stdin;$/.exec(line);
        if (header) columns = header[1].split(",").map((column) => column.trim());
        continue;
      }
      if (line === "\\.") break;
      const values = line.split("\t");
      const value = (column: string): string | null => {
        const raw = values[columns!.indexOf(column)];
        return raw === undefined || raw === "\\N" ? null : raw;
      };
      const name = value("migration_name");
      if (!name || value("rolled_back_at") !== null) continue;
      (value("finished_at") !== null ? finished : started).add(name);
    }
  } finally {
    lines.close();
  }
  if (!columns) return null;
  return {
    applied: [...finished].sort(),
    unfinished: [...started].filter((name) => !finished.has(name)).sort(),
  };
}

/** The migrations this version ships, in the order Prisma applies them. */
export function listLocalMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, "migration.sql")))
    .sort();
}

/**
 * The migrations to apply after the dump, or the refusal that stops the
 * restore before anything is written. Pending migrations keep this version's
 * order, gaps included — the same set `prisma migrate deploy` would apply.
 */
export function planArchiveMigrations(archive: ArchiveSchema | null, local: string[]): string[] {
  if (!archive) {
    throw new AppError(
      "This archive's database carries no migration history (_prisma_migrations), so it cannot be " +
        "matched to this version's schema. Nothing was restored.",
      400,
      "RESTORE_ARCHIVE_UNVERSIONED"
    );
  }
  const known = new Set(local);
  const unknown = archive.applied.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new AppError(
      `This archive was written by a newer TravStats version (or a development build): its database ` +
        `carries ${unknown.length} migration(s) this version does not know, the latest ` +
        `${unknown[unknown.length - 1]}. A schema cannot be migrated down. Update this instance to the ` +
        "archive's version or later and restore again. Nothing was restored.",
      409,
      "RESTORE_ARCHIVE_NEWER"
    );
  }
  if (archive.unfinished.length > 0) {
    throw new AppError(
      `This archive was taken while migration ${archive.unfinished.join(", ")} had failed on its ` +
        "database, so its schema is not one any version describes. Nothing was restored.",
      400,
      "RESTORE_ARCHIVE_FAILED_MIGRATION"
    );
  }
  const applied = new Set(archive.applied);
  return local.filter((name) => !applied.has(name));
}

/**
 * The SQL psql runs after the dump: each pending migration, its marker, and
 * its `_prisma_migrations` row as `prisma migrate deploy` writes it (checksum =
 * SHA-256 of the file, measured equal on all 186 migrations on 2026-10-04).
 *
 * `RESET ALL` first, and before every migration: the dump empties
 * `search_path` and turns `check_function_bodies` off for its own session, and
 * a migration written for Prisma expects a fresh one. Empty when nothing is
 * pending, so a same-version restore sends psql exactly what it did before.
 */
export function migrationEpilogue(pending: string[], dir: string = MIGRATIONS_DIR): string {
  return pending
    .map((name) => {
      if (!MIGRATION_NAME.test(name)) throw new Error(`Unexpected migration name: ${name}`);
      const sql = fs.readFileSync(path.join(dir, name, "migration.sql"));
      const checksum = createHash("sha256").update(sql).digest("hex");
      return [
        "",
        "RESET ALL;",
        `\\echo ${MIGRATION_MARKER}${name}`,
        sql.toString("utf-8"),
        // Ends a last statement the file left open, so the marker and the
        // INSERT below are never swallowed into it.
        ";",
        `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", ` +
          `"logs", "rolled_back_at", "started_at", "applied_steps_count") VALUES ` +
          `('${randomUUID()}', '${checksum}', clock_timestamp(), '${name}', NULL, NULL, clock_timestamp(), 1);`,
      ].join("\n");
    })
    .join("\n")
    .concat(pending.length > 0 ? "\n" : "");
}

/**
 * What a restored database still lacks, asked of the database itself once
 * psql has committed: every migration of this version recorded as finished,
 * none left unfinished. Read-only.
 */
export async function missingMigrations(local: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished: boolean }>>`
    SELECT migration_name, finished_at IS NOT NULL AS finished
    FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`;
  const finished = new Set(rows.filter((row) => row.finished).map((row) => row.migration_name));
  const unfinished = rows
    .filter((row) => !row.finished)
    .map((row) => `${row.migration_name} (failed)`);
  return [...local.filter((name) => !finished.has(name)), ...unfinished];
}

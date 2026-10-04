import { spawn } from "child_process";
import * as fs from "fs";
import logger from "../../utils/logger";

/** What psql prints just before a migration's SQL (`restoreMigrations.ts`), so a failure can name it. */
export const MIGRATION_MARKER = "travstats-restore-migration:";

/**
 * Run before the dump, inside the same transaction (forgejo#157).
 *
 * A `pg_dump --clean` drops and recreates only what is IN the dump. Restored
 * onto a newer version, everything the newer schema added stayed behind:
 * measured on 2026-10-02, a 2.7.0-beta.17 archive restored onto beta.18 failed
 * outright, because two newer tables hold foreign keys to `users` and the
 * dump's `DROP CONSTRAINT users_pkey` cannot cascade; an archive without such
 * a table "succeeded" with every sync trigger gone, the newer tables left
 * standing and `_prisma_migrations` rolled back, so the next boot re-ran a
 * migration into its own leftovers and the one after that stopped applying
 * migrations at all.
 *
 * Emptying `public` first makes the dump land in exactly the schema it
 * describes; the migration epilogue (`restoreMigrations.ts`) then brings that
 * schema up to this version in the same run.
 *
 * PostGIS: dropping `public` with CASCADE drops the extensions installed in it
 * (postgis, pg_trgm, unaccent, fuzzystrmatch) and the ones that depend on
 * postgis (postgis_topology, postgis_tiger_geocoder). That is safe because
 * our `pg_dump` call emits `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA …`
 * for every one of them, and the schemas `topology`, `tiger` and `tiger_data`
 * with them — measured on 2026-10-04 against postgis/postgis:15-3.4,
 * ST_Distance answering afterwards. Under `--single-transaction` a failing
 * dump rolls the DROP back too, so a refused archive still changes nothing.
 */
export const CLEAN_SCHEMA_PREAMBLE = [
  // The CASCADE below names every dropped object in a NOTICE — hundreds of
  // lines on stderr that would bury psql's actual error in the log and in the
  // admin's message. The dump sets the same level itself a few lines later.
  "SET client_min_messages = warning;",
  "DROP SCHEMA IF EXISTS public CASCADE;",
  "CREATE SCHEMA public;",
  // A schema created here belongs to whoever runs the restore, with no
  // grants. Put back what PostgreSQL 15+ gives `public` by default, so a
  // second role (a read-only monitoring login) keeps its access after a
  // restore. Measured on 2026-10-02: the owner went from pg_database_owner to
  // the app role, and USAGE for PUBLIC was gone. The role check keeps older
  // servers, which have no pg_database_owner, restorable.
  "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pg_database_owner') " +
    "THEN ALTER SCHEMA public OWNER TO pg_database_owner; END IF; END $$;",
  "GRANT USAGE ON SCHEMA public TO PUBLIC;",
  "",
].join("\n");

/**
 * psql's stderr without the archive's row data. A failing COPY quotes the row
 * it choked on (`CONTEXT:  COPY users, line 3: "…"`) and a unique violation
 * the key (`Key (username)=(…)`); both reach the log and the job's message, and
 * neither may carry the user's data there.
 */
export function redactRowData(text: string): string {
  return text
    .replace(/(COPY [^,\n]+, line \d+(?:, column [^:\n]+)?):.*$/gm, "$1: [row data withheld]")
    .replace(/(Key \([^)]*\))=\(.*?\)( already exists| is not present)/g, "$1=(…)$2");
}

/** The last lines psql printed, for the error an admin reads mid-recovery. */
export function stderrTail(stderr: string): string {
  return redactRowData(stderr).trim().split("\n").slice(-3).join("; ");
}

/**
 * psql did not commit. `failedMigration` names the migration it was applying
 * when it stopped, or is null when it stopped in the dump itself. Either way
 * `--single-transaction` rolled everything back.
 */
export class PsqlRestoreError extends Error {
  constructor(
    message: string,
    readonly failedMigration: string | null
  ) {
    super(message);
    this.name = "PsqlRestoreError";
  }
}

/** The last migration marker psql printed, or null. */
function lastMarker(stdout: string): string | null {
  let found: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith(MIGRATION_MARKER)) found = line.slice(MIGRATION_MARKER.length).trim();
  }
  return found;
}

/**
 * Feed `preamble`, the dump at `dumpPath` and `epilogue` to a psql process and
 * settle with its verdict.
 *
 * psql stops reading at the first error (ON_ERROR_STOP) while the dump is
 * still being piped in, and the next write then fails with EPIPE. That error
 * had no handler: it killed the whole backend, the restore job vanished with
 * the process, and the admin never learned that the restore had failed
 * (forgejo#157). Every stream here now reports into this one promise.
 *
 * stdout is scanned only for the migration markers; the dump's own output (the
 * command tags, `setval` results) carries no row data, and is logged at debug.
 *
 * Exported for its test, which drives a real child process.
 */
export function feedPsql(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  dumpPath: string,
  preamble: string,
  epilogue = ""
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    const proc = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let stderrLogged = 0;
    let partialLine = "";
    let migration: string | null = null;
    let inputError: Error | null = null;

    // EPIPE / ECONNRESET: psql has stopped reading. Its exit code and stderr,
    // handled in `close`, say why; this only keeps the error from escaping.
    proc.stdin.on("error", (error) => {
      inputError = error;
    });
    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      const lines = (partialLine + text).split("\n");
      partialLine = lines.pop() ?? "";
      migration = lastMarker(lines.join("\n")) ?? migration;
      logger.debug({ operation: "restore_db_stdout", message: text });
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      // Whole lines only, so a quoted row split across two chunks is still
      // recognised by `redactRowData`.
      const end = stderr.lastIndexOf("\n") + 1;
      if (end > stderrLogged) {
        logger.warn({
          operation: "restore_db_stderr",
          message: redactRowData(stderr.slice(stderrLogged, end)),
        });
        stderrLogged = end;
      }
    });
    proc.on("error", (error) => settle(new Error(`Failed to start ${cmd}: ${error.message}`)));
    proc.on("close", (code) => {
      if (stderr.length > stderrLogged) {
        logger.warn({
          operation: "restore_db_stderr",
          message: redactRowData(stderr.slice(stderrLogged)),
        });
      }
      if (code === 0 && !inputError) {
        settle();
        return;
      }
      const detail = stderrTail(stderr) || inputError?.message || "";
      settle(
        new PsqlRestoreError(
          `${cmd} exited with code ${code}${detail ? `: ${detail}` : ""}`,
          lastMarker(partialLine) ?? migration
        )
      );
    });

    const input = fs.createReadStream(dumpPath);
    input.on("error", (error) => {
      proc.kill();
      settle(new Error(`Could not read the archive's database.sql: ${error.message}`));
    });
    proc.stdin.write(preamble);
    input.pipe(proc.stdin, { end: false });
    input.on("end", () => proc.stdin.end(epilogue));
  });
}

import { spawn } from "child_process";
import * as fs from "fs";
import { Transform } from "stream";
import { StringDecoder } from "string_decoder";
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
 * The restore preamble for an app role that is NOT a superuser (forgejo#415 N5).
 *
 * `DROP SCHEMA public CASCADE` takes postgis with it, and only a superuser can
 * `CREATE EXTENSION postgis` again (it is not a trusted extension). So this
 * variant keeps the schema and every extension (postgis, `spatial_ref_sys`,
 * pg_trgm, unaccent, fuzzystrmatch) and drops just what the app created: the
 * relations, standalone sequences, functions/aggregates and enum/domain/range
 * types in `public` that are not members of an extension. The dump then lands
 * in the same emptied schema the superuser variant produces. An object owned by
 * another role fails the DROP, and the single transaction rolls everything back.
 */
export const SOFT_CLEAN_SCHEMA_PREAMBLE = [
  "SET client_min_messages = warning;",
  `DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relkind, n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S','c')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid AND d.deptype IN ('e','i','a'))
    ORDER BY CASE c.relkind WHEN 'v' THEN 0 WHEN 'm' THEN 0 WHEN 'S' THEN 2 WHEN 'c' THEN 3 ELSE 1 END
  LOOP
    EXECUTE format('DROP %s IF EXISTS %I.%I CASCADE',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
                     WHEN 'S' THEN 'SEQUENCE' WHEN 'c' THEN 'TYPE' ELSE 'TABLE' END,
      r.nspname, r.relname);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prokind
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                      AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP %s IF EXISTS %s CASCADE',
      CASE r.prokind WHEN 'a' THEN 'AGGREGATE' WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.sig);
  END LOOP;
  FOR r IN
    SELECT t.oid, n.nspname, t.typname
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e','d','r')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass
                      AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', r.nspname, r.typname);
  END LOOP;
END $$;`,
  "",
].join("\n");

const EXTENSION_SCHEMAS = "(?:tiger|tiger_data|topology)";
/** Statements that need ownership of an extension or its schemas; the extensions stay in place. */
const SKIPPED_STATEMENTS = [
  /^DROP EXTENSION IF EXISTS /,
  /^COMMENT ON EXTENSION /,
  new RegExp(`^(?:DROP|CREATE) SCHEMA (?:IF EXISTS )?${EXTENSION_SCHEMAS};`),
  new RegExp(`^ALTER SCHEMA ${EXTENSION_SCHEMAS} OWNER TO `),
  new RegExp(`^COMMENT ON SCHEMA ${EXTENSION_SCHEMAS} `),
  new RegExp(`^SELECT pg_catalog\\.setval\\('${EXTENSION_SCHEMAS}\\.`),
];
/** Reference/config data owned by an extension, identical on every install. */
const SKIPPED_COPY = new RegExp(`^COPY (?:public\\.spatial_ref_sys|${EXTENSION_SCHEMAS}\\.)`);

/**
 * Line filter for a dump replayed by a non-superuser. `pg_dump --clean` emits
 * `DROP EXTENSION postgis`, `COMMENT ON EXTENSION` and the data of the
 * extensions' own tables, none of which a non-owner may run. The extensions are
 * left exactly as they are. COPY row data is passed through untouched (a data
 * row can never start a statement, because the state machine is inside COPY).
 */
export function createNonSuperuserDumpFilter(): Transform {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  let inCopy = false;
  let skippingCopy = false;
  const filterLine = (line: string): string | null => {
    if (inCopy) {
      const wasSkipping = skippingCopy;
      if (line === "\\.") {
        inCopy = false;
        skippingCopy = false;
      }
      return wasSkipping ? null : line;
    }
    if (line.startsWith("COPY ") && line.endsWith("FROM stdin;")) {
      inCopy = true;
      skippingCopy = SKIPPED_COPY.test(line);
      return skippingCopy ? null : line;
    }
    return SKIPPED_STATEMENTS.some((re) => re.test(line)) ? null : line;
  };
  const emit = (text: string, final: boolean): string => {
    const lines = (rest + text).split("\n");
    rest = final ? "" : (lines.pop() ?? "");
    let out = "";
    for (const line of lines) {
      const kept = filterLine(line);
      if (kept !== null) out += kept + "\n";
    }
    return out;
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      // A multibyte character split across two chunks must not be decoded half by half.
      cb(null, emit(decoder.write(chunk), false));
    },
    flush(cb) {
      const tail = decoder.end();
      cb(null, rest || tail ? emit(tail, true).replace(/\n$/, "") : "");
    },
  });
}

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
  epilogue = "",
  filter?: Transform
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
    if (filter) {
      filter.on("error", (error) => {
        proc.kill();
        settle(new Error(`Could not filter the archive's database.sql: ${error.message}`));
      });
      input.pipe(filter).pipe(proc.stdin, { end: false });
      filter.on("end", () => proc.stdin.end(epilogue));
    } else {
      input.pipe(proc.stdin, { end: false });
      input.on("end", () => proc.stdin.end(epilogue));
    }
  });
}

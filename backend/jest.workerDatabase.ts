import { Client } from "pg";

/**
 * One database per Jest worker in a parallel run.
 *
 * The suite is destructive by design: twenty-four files call
 * `user.deleteMany()` with no filter, others empty whole catalogues (ports,
 * airports) and reseed them, and several expect to register the instance's
 * FIRST user. That is only sound when nothing else runs against the same
 * database at the same time. `jest.config.js` therefore runs serially, and CI
 * shards the files across four jobs with a Postgres each.
 *
 * `--maxWorkers=4` against one database broke that promise silently: a wipe in
 * one worker landed in the middle of another worker's file, users vanished
 * between two requests, and the run reported hundreds of FK violations, 401s
 * and 403s that read like broken code. Measured 2026-09-27: 51 of 791 suites
 * red at four workers, 0 serially — and the commit before the demo-seed merges
 * was red the same way, so no merge was ever the cause.
 *
 * So a parallel run gives every worker a copy of the migrated, catalogue-seeded
 * database (`CREATE DATABASE … TEMPLATE`), and `jest.setup.ts` points each
 * worker at its own. A serial run (the default, and CI) is untouched: it keeps
 * using `DATABASE_URL` as given.
 */

/** Set by globalSetup when the run uses per-worker databases; read in jest.setup.ts. */
export const WORKER_DB_ENV = "TRAVSTATS_TEST_DB_PER_WORKER";
/** How many copies globalSetup made, so globalTeardown drops exactly those. */
export const WORKER_COUNT_ENV = "TRAVSTATS_TEST_DB_WORKER_COUNT";
/** DATABASE_URL as the run was started with, before any worker suffix. */
export const BASE_URL_ENV = "TRAVSTATS_TEST_DB_BASE_URL";

function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) {
    throw new Error("DATABASE_URL carries no database name; a per-worker copy needs one.");
  }
  return name;
}

/** The URL of worker `workerId`'s own copy of the database in `url`. */
export function workerDatabaseUrl(url: string, workerId: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(`${databaseName(parsed)}_w${workerId}`)}`;
  return parsed.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A client on the server's maintenance database: a template cannot be copied from inside itself. */
function maintenanceClient(url: string): Client {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  parsed.search = "";
  return new Client({ connectionString: parsed.toString() });
}

function workerNames(url: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    databaseName(new URL(workerDatabaseUrl(url, i + 1)))
  );
}

/**
 * (Re)creates `count` copies of the database in `url`, named `<db>_w1` … `<db>_wN`.
 *
 * A copy left by an earlier run is dropped first, so every run starts from the
 * template as it is now. If the template is in use by another session —
 * typically a dev server on the same database — Postgres refuses the copy, and
 * that refusal is passed on as it is: falling back to one shared database would
 * bring back exactly the silent cross-file failures this exists to prevent.
 */
export async function createWorkerDatabases(url: string, count: number): Promise<void> {
  const template = databaseName(new URL(url));
  const client = maintenanceClient(url);
  await client.connect();
  try {
    for (const name of workerNames(url, count)) {
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      try {
        await client.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Could not copy "${template}" for a parallel test run: ${reason}. ` +
            "Close other connections to it (a dev server, psql), or run with --maxWorkers=1."
        );
      }
    }
  } finally {
    await client.end();
  }
}

/** Drops the copies made by `createWorkerDatabases`. */
export async function dropWorkerDatabases(url: string, count: number): Promise<void> {
  const client = maintenanceClient(url);
  await client.connect();
  try {
    for (const name of workerNames(url, count)) {
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
    }
  } finally {
    await client.end();
  }
}

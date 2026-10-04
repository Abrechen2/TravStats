import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "pg";
import request from "supertest";
import type { Express } from "express";

import type { PrismaClient } from "../../../prisma";
import type * as JobRegistry from "../../jobs/jobRegistry";

/**
 * forgejo#157, end to end against a real PostgreSQL: an archive written by an
 * OLDER version, restored through the real route and job, with the app's own
 * pg_dump call producing the archive and psql replaying it.
 *
 * Measured on 2026-10-02 with the real images: a 2.6-era archive restored onto
 * 2.7 failed because two newer tables hold foreign keys to `users`, and the
 * EPIPE that followed killed the backend; an archive without such a table
 * "succeeded" with every sync trigger gone and `_prisma_migrations` rolled
 * back, which blocked every later migration. The pieces were unit-tested; this
 * suite is the round trip.
 *
 * The suite builds its own databases beside the one in DATABASE_URL and drops
 * them afterwards, because every restore here replaces a whole schema:
 *   <db>_r157_old  — migrated only up to before FIRST_NEW, with synthetic rows;
 *   <db>_r157_live — migrated to this version; the app is pointed at it.
 *
 * It needs `pg_dump` and `psql` on PATH, at least the server's major version
 * (CI's ubuntu runner has both). Without them it is skipped with a note.
 */

const TOOLS_MISSING = ["pg_dump", "psql"].filter(
  (tool) => spawnSync(tool, ["--version"], { stdio: "ignore" }).status !== 0
);
const describeWithTools = TOOLS_MISSING.length === 0 ? describe : describe.skip;
if (TOOLS_MISSING.length > 0) {
  process.stderr.write(
    `restoreOlderArchive: skipped, ${TOOLS_MISSING.join(" and ")} not on PATH\n`
  );
}

const BACKEND = path.join(__dirname, "../../../..");
const MIGRATIONS = path.join(BACKEND, "prisma/migrations");
const PRISMA_CLI = require.resolve("prisma/build/index.js", { paths: [BACKEND] });

/**
 * The first migration the "old" archive lacks: everything before it is
 * exactly the migration set of the v2.6.3 release (checked against the tag on
 * 2026-10-04), so the old database is a 2.6 one — the restore the issue names
 * as release-relevant. The 2.7 migrations after it include `trip_expenses` and
 * `rental_bookings`, which hold foreign keys to `users` (case A), and the sync
 * triggers (case B). `99999999999999_remove_imported_flights` sorts last but
 * is in 2.6.3, so the old archive has it.
 */
const FIRST_NEW = "20260909201004_add_session_epoch";

const ALL_MIGRATIONS = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => fs.existsSync(path.join(MIGRATIONS, name, "migration.sql")))
  .sort();
const OLD_MIGRATIONS = ALL_MIGRATIONS.filter(
  (name) => name < FIRST_NEW || name.startsWith("99999999999999")
);

const BASE_URL = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
const BASE_NAME = decodeURIComponent(BASE_URL.pathname.slice(1));
const OLD_DB = `${BASE_NAME}_r157_old`;
const LIVE_DB = `${BASE_NAME}_r157_live`;

/** A URL on the same server, without the jest-only query (pg and the CLI reject it). */
function urlFor(database: string): string {
  const url = new URL(BASE_URL.toString());
  url.pathname = `/${encodeURIComponent(database)}`;
  url.search = "";
  return url.toString();
}

async function withClient<T>(database: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name: string): Promise<void> {
  await withClient("postgres", async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDatabase(name: string): Promise<void> {
  await withClient("postgres", (client) =>
    client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  );
}

/** `prisma migrate deploy` with exactly `names` in the migrations directory. */
function migrate(database: string, names: string[], workDir: string): void {
  const dir = fs.mkdtempSync(path.join(workDir, "migrate-"));
  fs.mkdirSync(path.join(dir, "migrations"));
  fs.copyFileSync(
    path.join(MIGRATIONS, "migration_lock.toml"),
    path.join(dir, "migrations", "migration_lock.toml")
  );
  for (const name of names) {
    fs.cpSync(path.join(MIGRATIONS, name), path.join(dir, "migrations", name), {
      recursive: true,
    });
  }
  fs.copyFileSync(path.join(BACKEND, "prisma/schema.prisma"), path.join(dir, "schema.prisma"));
  fs.writeFileSync(
    path.join(dir, "prisma.config.ts"),
    `export default { schema: "schema.prisma", migrations: { path: "migrations" }, ` +
      `datasource: { url: ${JSON.stringify(urlFor(database))} } };\n`
  );
  const run = spawnSync(
    process.execPath,
    [PRISMA_CLI, "migrate", "deploy", "--config", path.join(dir, "prisma.config.ts")],
    { cwd: dir, encoding: "utf-8" }
  );
  if (run.status !== 0) {
    throw new Error(`migrate deploy of ${database} failed: ${run.stdout}\n${run.stderr}`);
  }
}

/** A restore archive as `createBackup` lays it out, database part only. */
function packArchive(dumpPath: string, workDir: string, label: string): string {
  const dir = fs.mkdtempSync(path.join(workDir, `${label}-`));
  fs.copyFileSync(dumpPath, path.join(dir, "database.sql"));
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ label }));
  const archive = path.join(workDir, `${label}.tar.gz`);
  const tar = spawnSync("tar", ["-czf", archive, "-C", dir, "database.sql", "metadata.json"]);
  if (tar.status !== 0) throw new Error(`tar failed for ${label}`);
  return archive;
}

async function queryLive<T>(sql: string): Promise<T[]> {
  return withClient(LIVE_DB, async (client) => (await client.query(sql)).rows as T[]);
}

describeWithTools("restoring an archive written by another version (forgejo#157)", () => {
  jest.setTimeout(600_000);

  let workDir: string;
  let app: Express;
  let prisma: PrismaClient;
  let jobs: typeof JobRegistry;
  let createDatabaseDump: (outputPath: string, targetDatabaseUrl?: string) => Promise<void>;
  const archives: Record<"older" | "colliding" | "earlyExit" | "newer", string> = {
    older: "",
    colliding: "",
    earlyExit: "",
    newer: "",
  };
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-157-"));

    // The old instance: migrations up to before FIRST_NEW, plus a few rows.
    await recreateDatabase(OLD_DB);
    migrate(OLD_DB, OLD_MIGRATIONS, workDir);
    await withClient(OLD_DB, async (client) => {
      await client.query(
        `INSERT INTO users (id, username, password_hash) VALUES ('r157-owner', 'r157-owner', 'x')`
      );
      await client.query(
        `INSERT INTO flights (id, user_id, dep_lat, dep_lon, arr_lat, arr_lon, flight_number)
         VALUES ('r157-flight', 'r157-owner', 50.03, 8.57, 40.64, -73.78, 'LH400')`
      );
      await client.query(
        `INSERT INTO trips (id, user_id, name, updated_at)
         VALUES ('r157-trip', 'r157-owner', 'Restored trip', now())`
      );
    });

    // The live instance the app runs on: this version's schema.
    await recreateDatabase(LIVE_DB);
    migrate(LIVE_DB, ALL_MIGRATIONS, workDir);

    // Point the app at the live database BEFORE any of it is loaded.
    const liveUrl = new URL(urlFor(LIVE_DB));
    liveUrl.search = "?connection_limit=5";
    process.env.DATABASE_URL = liveUrl.toString();
    process.env.BACKUP_PATH = path.join(workDir, "backups");
    delete process.env.DOCKER;
    jest.resetModules();
    app = (await import("../../../index")).default;
    prisma = (await import("../../../db")).prisma;
    jobs = await import("../../jobs/jobRegistry");
    createDatabaseDump = (await import("../backupDatabase")).createDatabaseDump;

    // Each archive is written by the app's own pg_dump call.
    const olderDump = path.join(workDir, "older.sql");
    await createDatabaseDump(olderDump, urlFor(OLD_DB));
    archives.older = packArchive(olderDump, workDir, "older");

    // An old archive one of whose pending migrations cannot apply: it already
    // has a table of that name. Stands in for any migration that fails on real
    // data.
    await withClient(OLD_DB, (client) => client.query(`CREATE TABLE trip_expenses (id int)`));
    const collidingDump = path.join(workDir, "colliding.sql");
    await createDatabaseDump(collidingDump, urlFor(OLD_DB));
    await withClient(OLD_DB, (client) => client.query(`DROP TABLE trip_expenses`));
    archives.colliding = packArchive(collidingDump, workDir, "colliding");

    // psql stops at the first statement while the rest is still being piped.
    // The tail is padded far past any pipe buffer, so the writer is certainly
    // still writing when the reader has gone — the exact shape of the crash.
    const earlyExitDump = path.join(workDir, "early-exit.sql");
    fs.writeFileSync(
      earlyExitDump,
      "SELECT * FROM restore_157_no_such_table;\n" +
        fs.readFileSync(olderDump, "utf-8") +
        "-- padding\n".repeat(2_000_000)
    );
    archives.earlyExit = packArchive(earlyExitDump, workDir, "early-exit");

    // An archive from a version that knows a migration this one does not.
    await withClient(LIVE_DB, (client) =>
      client.query(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ('r157-future', 'x', now(), '29991231000000_from_the_future', now(), 1)`
      )
    );
    const newerDump = path.join(workDir, "newer.sql");
    await createDatabaseDump(newerDump, urlFor(LIVE_DB));
    await withClient(LIVE_DB, (client) =>
      client.query(`DELETE FROM _prisma_migrations WHERE id = 'r157-future'`)
    );
    archives.newer = packArchive(newerDump, workDir, "newer");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env = originalEnv;
    await dropDatabase(LIVE_DB);
    await dropDatabase(OLD_DB);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  /** An admin to call the route as, a marker row to see whether the database moved, and the backup row. */
  async function prepare(label: string, archive: string) {
    const admin = await prisma.user.create({
      data: { username: `r157-admin-${label}`, passwordHash: "x", isAdmin: true, isActive: true },
    });
    const { generateToken } = await import("../../../utils/jwt");
    const backup = await prisma.backup.create({
      data: { status: "completed", backupPath: archive, completedAt: new Date() },
    });
    return { admin, cookie: `auth_token=${generateToken(admin.id)}`, backupId: backup.id };
  }

  async function restore(label: string, archive: string) {
    const { admin, cookie, backupId } = await prepare(label, archive);
    const res = await request(app)
      .post(`/api/v1/backup/${backupId}/restore`)
      .set("Cookie", cookie)
      .send({ scope: "database", createBackupBefore: false });
    expect(res.status).toBe(202);
    await jobs.settleAllJobs();
    const job = jobs.getJob(res.body.data.jobId, admin.id);
    return { job, admin, backupId };
  }

  async function syncTriggerCount(): Promise<number> {
    const [row] = await queryLive<{ n: string }>(
      `SELECT count(*) AS n FROM pg_trigger WHERE tgname IN ('AA_sync_change', 'sync_advance_updated_at')`
    );
    return Number(row.n);
  }

  async function migrationRows(): Promise<{ finished: string[]; unfinished: number }> {
    const rows = await queryLive<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL`
    );
    return {
      finished: rows
        .filter((r) => r.finished_at)
        .map((r) => r.migration_name)
        .sort(),
      unfinished: rows.filter((r) => !r.finished_at).length,
    };
  }

  /** What a failed restore must leave exactly as it was. */
  async function liveSnapshot() {
    return {
      users: (await queryLive<{ username: string }>(`SELECT username FROM users ORDER BY 1`)).map(
        (r) => r.username
      ),
      triggers: await syncTriggerCount(),
      migrations: await migrationRows(),
      tripExpenseColumns: (
        await queryLive<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'trip_expenses' ORDER BY 1`
        )
      ).map((r) => r.column_name),
    };
  }

  it("starts from a live database at this version, with every sync trigger", async () => {
    expect((await migrationRows()).finished).toEqual(ALL_MIGRATIONS);
    expect(await syncTriggerCount()).toBeGreaterThan(0);
  });

  it("refuses an archive from a newer version before writing anything", async () => {
    const before = await liveSnapshot();
    const { job, admin } = await restore("newer", archives.newer);

    expect(job).toMatchObject({ status: "failed", error: { code: "RESTORE_ARCHIVE_NEWER" } });
    expect(await liveSnapshot()).toEqual({
      ...before,
      users: [...before.users, admin.username].sort(),
    });
  });

  it("rolls everything back when a pending migration cannot apply, and says which", async () => {
    const before = await liveSnapshot();
    const { job, admin } = await restore("colliding", archives.colliding);

    expect(job).toMatchObject({ status: "failed", error: { code: "RESTORE_MIGRATION_FAILED" } });
    expect(await liveSnapshot()).toEqual({
      ...before,
      users: [...before.users, admin.username].sort(),
    });
  });

  it("reports a psql that quits mid-stream as a failed job, and the backend survives", async () => {
    const before = await liveSnapshot();
    const { job, admin } = await restore("early-exit", archives.earlyExit);

    expect(job).toMatchObject({ status: "failed", error: { code: "RESTORE_FAILED" } });
    expect(await liveSnapshot()).toEqual({
      ...before,
      users: [...before.users, admin.username].sort(),
    });
    // Still answering: an unhandled EPIPE would have ended this process.
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("restores an older archive into this version's schema, with its rows, triggers and history", async () => {
    const triggersAtThisVersion = await syncTriggerCount();
    const [epochBefore] = await queryLive<{ epoch: string }>(`SELECT epoch FROM sync_state`);

    const { job } = await restore("older", archives.older);
    expect(job).toMatchObject({ status: "succeeded" });

    // The archive's rows, and only those: the live admins are gone.
    expect(
      (await queryLive<{ username: string }>(`SELECT username FROM users`)).map((r) => r.username)
    ).toEqual(["r157-owner"]);
    expect(await queryLive(`SELECT id, flight_number FROM flights`)).toEqual([
      { id: "r157-flight", flight_number: "LH400" },
    ]);
    expect(await queryLive(`SELECT id FROM trips`)).toEqual([{ id: "r157-trip" }]);

    // This version's schema: the tables 2.7 added, every migration recorded.
    expect(await migrationRows()).toEqual({ finished: ALL_MIGRATIONS, unfinished: 0 });
    expect(await queryLive(`SELECT count(*)::int AS n FROM trip_expenses`)).toEqual([{ n: 0 }]);
    expect(await queryLive(`SELECT count(*)::int AS n FROM rental_bookings`)).toEqual([{ n: 0 }]);
    expect(await syncTriggerCount()).toBe(triggersAtThisVersion);

    // PostGIS survived the schema being emptied and refilled.
    expect(
      await queryLive(
        `SELECT round(ST_Distance('SRID=4326;POINT(8.57 50.03)'::geography,
                                  'SRID=4326;POINT(-73.78 40.64)'::geography) / 1000) AS km`
      )
    ).toEqual([{ km: 6206 }]);

    // A new sync epoch, an empty feed — and the feed is alive again.
    const [epochAfter] = await queryLive<{ epoch: string }>(`SELECT epoch FROM sync_state`);
    expect(epochAfter.epoch).not.toBe(epochBefore.epoch);
    expect(await queryLive(`SELECT count(*)::int AS n FROM sync_changes`)).toEqual([{ n: 0 }]);
    await withClient(LIVE_DB, (client) =>
      client.query(`UPDATE flights SET flight_number = 'LH401' WHERE id = 'r157-flight'`)
    );
    expect(
      await queryLive(`SELECT entity, entity_id FROM sync_changes WHERE entity = 'flight'`)
    ).toEqual([{ entity: "flight", entity_id: "r157-flight" }]);

    // /health agrees.
    expect((await request(app).get("/health")).body).toMatchObject({
      checks: { syncTriggers: "ok" },
    });
  });

  it("still round-trips an archive written by this version", async () => {
    const sameDump = path.join(workDir, "same.sql");
    await createDatabaseDump(sameDump);
    const archive = packArchive(sameDump, workDir, "same");
    const triggers = await syncTriggerCount();
    const [epochBefore] = await queryLive<{ epoch: string }>(`SELECT epoch FROM sync_state`);

    const { job } = await restore("same", archive);
    expect(job).toMatchObject({ status: "succeeded" });

    expect(
      (await queryLive<{ username: string }>(`SELECT username FROM users`)).map((r) => r.username)
    ).toEqual(["r157-owner"]);
    expect(await queryLive(`SELECT flight_number FROM flights`)).toEqual([
      { flight_number: "LH401" },
    ]);
    expect(await migrationRows()).toEqual({ finished: ALL_MIGRATIONS, unfinished: 0 });
    expect(await syncTriggerCount()).toBe(triggers);
    const [epochAfter] = await queryLive<{ epoch: string }>(`SELECT epoch FROM sync_state`);
    expect(epochAfter.epoch).not.toBe(epochBefore.epoch);
  });
});

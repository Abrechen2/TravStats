/**
 * A pre-migration backup that fails on a version change stops the boot.
 *
 * It did not. `preMigrationBackup.ts` printed
 * `WARNING: version changed but backup failed — continuing` and exited 0; the
 * entrypoint printed its own "continuing" on top and ran `prisma migrate
 * deploy` anyway. The 2026-09-19 integrity audit reproduced it with
 * `Failed to start pg_dump`: the net came off with one WARN line and the
 * schema change went ahead against a database with nothing to go back to.
 *
 * The first block injects a failing dump and checks what the real code path
 * produces; the second exercises the decision on its own, because that is the
 * part the entrypoint's exit code hangs on.
 */

const createDatabaseDump = jest.fn();
jest.mock("../../services/backup/backupDatabase", () => ({
  createDatabaseDump: (outputPath: string) => createDatabaseDump(outputPath),
}));

// An existing install: the decision needs prior migrations to want a backup.
// `$extends` is here because `db.ts` builds the shared client from this same
// factory at import time, and `utils/logger` pulls it in transitively.
jest.mock("../../prismaClient", () => {
  const client = {
    $queryRawUnsafe: async () => [{ count: 7n }],
    $disconnect: async () => undefined,
    $extends: () => client,
  };
  return { createPrismaClient: () => client };
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-premigration-"));
process.env.BACKUP_PATH = BACKUP_DIR;

import { pgDumpSkew, majorVersionOf } from "../pgDumpSkew";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const upgradeBackup = require("../upgradeBackup") as typeof import("../upgradeBackup");
const {
  maybeRunPreMigrationBackup,
  preMigrationOutcome,
  skipPreMigrationBackupRequested,
  SKIP_PRE_MIGRATION_BACKUP_ENV,
} = upgradeBackup;

const PG_DUMP_FAILURE = "Failed to start pg_dump";

/** What `detectPgDumpSkew` produces for a client older than its server. */
const SKEW = pgDumpSkew("pg_dump (PostgreSQL) 15.7", "PostgreSQL 16.3 on x86_64-pc-linux-gnu")!;

describe("maybeRunPreMigrationBackup — an injected failing dump", () => {
  let originalSkip: string | undefined;

  beforeEach(() => {
    createDatabaseDump.mockReset();
    originalSkip = process.env[SKIP_PRE_MIGRATION_BACKUP_ENV];
    delete process.env[SKIP_PRE_MIGRATION_BACKUP_ENV];
    // A previous version on the volume makes this a version change.
    fs.writeFileSync(path.join(BACKUP_DIR, "last-version"), "0.0.1-previous");
  });

  afterEach(() => {
    if (originalSkip === undefined) delete process.env[SKIP_PRE_MIGRATION_BACKUP_ENV];
    else process.env[SKIP_PRE_MIGRATION_BACKUP_ENV] = originalSkip;
  });

  afterAll(() => {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  });

  it("carries the cause out of the context instead of swallowing it", async () => {
    createDatabaseDump.mockRejectedValue(new Error(PG_DUMP_FAILURE));

    const ctx = await maybeRunPreMigrationBackup();

    expect(ctx.shouldBackup).toBe(true);
    expect(ctx.backupCreated).toBeNull();
    // The old code logged this and dropped it on the floor; nothing downstream
    // could tell a failed backup from a skipped one.
    expect(ctx.backupError).toBe(PG_DUMP_FAILURE);
  });

  it("refuses the boot, naming the cause and the override", async () => {
    createDatabaseDump.mockRejectedValue(new Error(PG_DUMP_FAILURE));

    const ctx = await maybeRunPreMigrationBackup();
    const outcome = preMigrationOutcome({
      shouldBackup: ctx.shouldBackup,
      backupCreated: ctx.backupCreated,
      backupError: ctx.backupError,
      skipRequested: skipPreMigrationBackupRequested(),
    });

    expect(outcome.fatal).toBe(true);
    const message = outcome.lines.join("\n");
    expect(message).toContain(PG_DUMP_FAILURE);
    expect(message).toContain("SKIP_PRE_MIGRATION_BACKUP=true");
    // An operator reading this needs to know the database was not touched.
    expect(message).toContain("Migrations have NOT been run");
    expect(outcome.lines.length).toBeGreaterThan(1);
  });

  it("boots anyway, loudly, when the override is set", async () => {
    createDatabaseDump.mockRejectedValue(new Error(PG_DUMP_FAILURE));
    process.env[SKIP_PRE_MIGRATION_BACKUP_ENV] = "true";

    const ctx = await maybeRunPreMigrationBackup();
    const outcome = preMigrationOutcome({
      shouldBackup: ctx.shouldBackup,
      backupCreated: ctx.backupCreated,
      backupError: ctx.backupError,
      skipRequested: skipPreMigrationBackupRequested(),
    });

    expect(outcome.fatal).toBe(false);
    expect(outcome.lines.join("\n")).toContain("booting anyway");
  });

  it("is silent and non-fatal when the backup works", async () => {
    createDatabaseDump.mockResolvedValue(undefined);

    const ctx = await maybeRunPreMigrationBackup();
    const outcome = preMigrationOutcome({
      shouldBackup: ctx.shouldBackup,
      backupCreated: ctx.backupCreated,
      backupError: ctx.backupError,
      skipRequested: false,
    });

    expect(ctx.backupError).toBeNull();
    expect(outcome.fatal).toBe(false);
    expect(outcome.lines.join("\n")).toContain("Backup written");
  });
});

describe("preMigrationOutcome — naming a version skew", () => {
  it("puts the skew in the fatal message, beside the symptom", () => {
    // "Failed to start pg_dump" and "your pg_dump is older than your server"
    // read the same to an operator and have completely different fixes.
    const outcome = preMigrationOutcome({
      shouldBackup: true,
      backupCreated: null,
      backupError: PG_DUMP_FAILURE,
      skipRequested: false,
      versionSkew: SKEW,
    });

    expect(outcome.fatal).toBe(true);
    const message = outcome.lines.join("\n");
    expect(message).toContain(PG_DUMP_FAILURE);
    expect(message).toContain("pg_dump is version 15 and the server is version 16");
    expect(message).toContain("SKIP_PRE_MIGRATION_BACKUP=true");
  });

  it("carries the skew into the override warning too", () => {
    const outcome = preMigrationOutcome({
      shouldBackup: true,
      backupCreated: null,
      backupError: PG_DUMP_FAILURE,
      skipRequested: true,
      versionSkew: SKEW,
    });

    expect(outcome.fatal).toBe(false);
    expect(outcome.lines.join("\n")).toContain("pg_dump is version 15");
  });

  it("says nothing about versions when none was measured", () => {
    const outcome = preMigrationOutcome({
      shouldBackup: true,
      backupCreated: null,
      backupError: PG_DUMP_FAILURE,
      skipRequested: false,
      versionSkew: null,
    });

    expect(outcome.lines.join("\n")).not.toContain("Likely cause");
  });
});

describe("pgDumpSkew — the rule", () => {
  it("names a client older than its server, which pg_dump refuses outright", () => {
    expect(pgDumpSkew("pg_dump (PostgreSQL) 15.7", "PostgreSQL 16.3 on x86_64")).toContain(
      "version 15"
    );
  });

  it("says nothing about a NEWER client, which is supported and normal", () => {
    // The image ships 16 and plenty of people run 15. A warning nobody can act
    // on does not belong in the one message that has to be worth reading.
    expect(pgDumpSkew("pg_dump (PostgreSQL) 16.3", "PostgreSQL 15.7 on x86_64")).toBeNull();
    expect(pgDumpSkew("pg_dump (PostgreSQL) 16.3", "PostgreSQL 16.1 on x86_64")).toBeNull();
  });

  it("abstains when either side could not be read", () => {
    // An unread version is not evidence of a skew. Guessing would send someone
    // upgrading a Postgres that was never the problem.
    expect(pgDumpSkew(null, "PostgreSQL 16.3 on x86_64")).toBeNull();
    expect(pgDumpSkew("pg_dump (PostgreSQL) 15.7", null)).toBeNull();
    expect(pgDumpSkew("command not found", "PostgreSQL 16.3")).toBeNull();
  });

  it("reads the major out of what each side actually prints", () => {
    expect(majorVersionOf("pg_dump (PostgreSQL) 16.3")).toBe(16);
    expect(majorVersionOf("PostgreSQL 15.7 on x86_64-pc-linux-gnu, compiled by gcc")).toBe(15);
    expect(majorVersionOf("")).toBeNull();
  });
});

describe("preMigrationOutcome — the rule on its own", () => {
  it("never fails a boot that wanted no backup", () => {
    // A plain restart cannot be blocked by a backup it never tried to take.
    expect(
      preMigrationOutcome({
        shouldBackup: false,
        backupCreated: null,
        backupError: null,
        skipRequested: false,
      })
    ).toEqual({ fatal: false, lines: [] });
  });

  it("only accepts the literal string true as the override", () => {
    // Deliberately strict: "1", "yes" and an empty value are not consent to
    // upgrade without a snapshot.
    expect(skipPreMigrationBackupRequested({ [SKIP_PRE_MIGRATION_BACKUP_ENV]: "true" })).toBe(true);
    expect(skipPreMigrationBackupRequested({ [SKIP_PRE_MIGRATION_BACKUP_ENV]: "1" })).toBe(false);
    expect(skipPreMigrationBackupRequested({ [SKIP_PRE_MIGRATION_BACKUP_ENV]: "" })).toBe(false);
    expect(skipPreMigrationBackupRequested({})).toBe(false);
  });
});

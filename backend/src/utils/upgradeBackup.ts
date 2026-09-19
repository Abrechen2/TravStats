import * as fs from "fs";
import * as path from "path";
import { createPrismaClient } from "../prismaClient";
import logger from "./logger";
import { createDatabaseDump } from "../services/backup/backupDatabase";
import { detectPgDumpSkew } from "./pgDumpSkew";

const VERSION_FILE = path.join(__dirname, "..", "..", "VERSION");
const BACKUP_PATH = process.env.BACKUP_PATH || "/app/data/backups";
const LAST_VERSION_FILE = path.join(BACKUP_PATH, "last-version");

export interface UpgradeBackupContext {
  previousVersion: string | null;
  currentVersion: string;
  /** True whenever an EXISTING install is about to run a different build — any version change, not just a major one (#246). */
  shouldBackup: boolean;
  firstUpgradeFromPreMarker: boolean;
  backupCreated: string | null;
  /** The reason the backup did not happen, when one was wanted. Null when the
   *  backup succeeded or was never attempted. */
  backupError: string | null;
  /** A pg_dump/server version skew found BEFORE the attempt, as a sentence.
   *  Null when the versions agree or either could not be read. */
  versionSkew: string | null;
  /** Why the decision went the way it did, in words the console can print. */
  reason: string;
}

/** The env var an operator sets to boot anyway when the backup cannot be taken. */
export const SKIP_PRE_MIGRATION_BACKUP_ENV = "SKIP_PRE_MIGRATION_BACKUP";

/** What the caller should do once the backup attempt is over. */
export interface PreMigrationOutcome {
  /** True when the boot must stop before `prisma migrate deploy` runs. */
  fatal: boolean;
  /** Console lines, in order. Multi-line on purpose: this is read once, in a
   *  container log, by someone deciding whether to roll back. */
  lines: string[];
}

/**
 * Whether a failed pre-migration backup stops the boot.
 *
 * It used not to. The script logged `WARNING … continuing` and exited 0, and
 * the entrypoint printed its own "continuing" on top of that, so
 * `prisma migrate deploy` ran against an unbacked database. The 2026-09-19
 * integrity audit reproduced it with `Failed to start pg_dump`: the net came
 * off with one WARN line, and the schema change went ahead. The image does
 * ship pg_dump, but nothing checks client/server skew, a renamed container or
 * a full disk — all of which fail here and none of which anyone would see.
 *
 * So: a version change is the one moment a snapshot is worth a refusal, and a
 * refusal is recoverable while a half-migrated database is not.
 * `SKIP_PRE_MIGRATION_BACKUP=true` is the deliberate way past it, and it is
 * named in the message itself rather than in a wiki page nobody has open at
 * that moment. No version change, or a backup that worked, behaves exactly as
 * before.
 *
 * Pure, so the rule can be tested without a database, a version file or a
 * pg_dump binary.
 */
export function preMigrationOutcome(input: {
  shouldBackup: boolean;
  backupCreated: string | null;
  backupError: string | null;
  skipRequested: boolean;
  /** From `detectPgDumpSkew`, measured before the attempt. Optional so a
   *  caller that cannot probe simply says nothing about it. */
  versionSkew?: string | null;
}): PreMigrationOutcome {
  const { shouldBackup, backupCreated, backupError, skipRequested } = input;
  const versionSkew = input.versionSkew ?? null;

  if (!shouldBackup || backupError === null) {
    return {
      fatal: false,
      lines: backupCreated ? [`[pre-migration-backup] Backup written: ${backupCreated}`] : [],
    };
  }

  // Named on its own line when it is known, because "Failed to start pg_dump"
  // and "your pg_dump is older than your server" have completely different
  // fixes and the first cannot be told from the second.
  const skewLine = versionSkew ? [`[pre-migration-backup] Likely cause: ${versionSkew}`] : [];

  if (skipRequested) {
    return {
      fatal: false,
      lines: [
        "[pre-migration-backup] WARNING: the pre-migration backup failed and " +
          `${SKIP_PRE_MIGRATION_BACKUP_ENV} is set — booting anyway.`,
        `[pre-migration-backup] Cause: ${backupError}`,
        ...skewLine,
        "[pre-migration-backup] Migrations are about to run against a database " +
          "with no snapshot from before them.",
      ],
    };
  }

  return {
    fatal: true,
    lines: [
      "[pre-migration-backup] FATAL: this is a version change and the " +
        "pre-migration backup could NOT be created.",
      `[pre-migration-backup] Cause: ${backupError}`,
      ...skewLine,
      "[pre-migration-backup] Migrations have NOT been run. Your database is " +
        "untouched and the previous image still works.",
      "[pre-migration-backup] Fix the cause (usually: pg_dump missing or older " +
        "than the server's major version, the database container renamed, or " +
        "no free space under the backups directory), then start again.",
      `[pre-migration-backup] To upgrade WITHOUT a backup, set ${SKIP_PRE_MIGRATION_BACKUP_ENV}=true.`,
    ],
  };
}

/** True when the operator has asked to boot even without a usable backup. */
export function skipPreMigrationBackupRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SKIP_PRE_MIGRATION_BACKUP_ENV] === "true";
}

/**
 * The runtime version of the running container.
 *
 * Source of truth is the VERSION file baked into the image. APP_VERSION env is
 * honoured in exactly ONE case: when it is the promotion alias of the baked
 * version (a byte-identical RC retag ships a file saying "2.5.1-rc.1" while
 * compose says "2.5.1" — same binary, released identity). That keeps the
 * rc→final boot counting as a version change, which the #246 tests pin.
 *
 * Any OTHER disagreement is drift, and drift here has bitten twice on one
 * deploy day: a stale env said beta.1 while the image was beta.2 — the
 * pre-migration backup was silently SKIPPED on a real upgrade — and a shell
 * quoting slip stored `beta.2"` with a literal quote as the last-run version.
 * Trusting env unconditionally turns both into wrong backup decisions; the
 * baked file cannot drift from the binary it ships in.
 */
export function getCurrentVersion(): string {
  const baked = fs.existsSync(VERSION_FILE)
    ? fs.readFileSync(VERSION_FILE, "utf-8").trim()
    : "unknown";

  const env = process.env.APP_VERSION?.trim();
  if (env && env !== baked && baked !== "unknown") {
    if (env === stripPrerelease(baked)) return env; // promotion alias
    logger.warn({
      operation: "upgrade_backup_version_drift",
      message:
        "APP_VERSION disagrees with the baked VERSION file and is not its promotion alias — using the baked file",
      appVersionEnv: env,
      bakedVersion: baked,
    });
  }
  return env && baked === "unknown" ? env : baked;
}

/** Same rule as utils/version.ts — kept local because that module reads the
 *  VERSION file at import time, which the tests here re-point via mocks. */
function stripPrerelease(version: string): string {
  return version.replace(/-(rc|security-rc|beta|alpha)\.\d+$/, "");
}

/**
 * Returns the version that ran last on this data volume, or null on a
 * fresh install (no last-version file yet).
 */
export function getLastDeployedVersion(): string | null {
  if (!fs.existsSync(LAST_VERSION_FILE)) return null;
  const raw = fs.readFileSync(LAST_VERSION_FILE, "utf-8").trim();
  return raw.length > 0 ? raw : null;
}

export function writeLastDeployedVersion(version: string): void {
  fs.mkdirSync(path.dirname(LAST_VERSION_FILE), { recursive: true });
  fs.writeFileSync(LAST_VERSION_FILE, version, { mode: 0o644 });
}

/**
 * Triggered before `prisma migrate deploy` on every boot. Compares the
 * version that last ran on this data volume to the version we are about to
 * start. If they differ on an install that already has data, we snapshot the
 * database to /app/data/backups/pre-vX-upgrade-<ts>.sql BEFORE any migration
 * runs, so a failed upgrade leaves a recoverable state right next to the
 * running install. See `shouldBackupBeforeMigrating` for the exact rule —
 * it is ANY version change, not only a major one (#246).
 *
 * A failure is NOT soft any more. It used to be — "log a clear warning and
 * continue", on the reasoning that refusing to migrate would paint users into
 * a corner. It is the other way round: a refusal leaves the database untouched
 * and the previous image working, while a migration run without a snapshot can
 * leave nothing to go back to. `preMigrationOutcome` decides, and
 * `SKIP_PRE_MIGRATION_BACKUP=true` is the way past it.
 */
/**
 * Detects whether the database has any prior `_prisma_migrations` rows.
 * Used to identify "first upgrade after the last-version marker was
 * introduced" — pre-marker installs (anything before this code shipped)
 * have no last-version file but already carry data, so we treat them
 * as a major bump worth backing up.
 *
 * Returns false if the table or DB doesn't exist (truly fresh install).
 */
async function hasExistingMigrations(): Promise<boolean> {
  const prisma = createPrismaClient();
  try {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"`
    );
    const count = result[0]?.count ?? 0n;
    return count > 0n;
  } catch {
    // Table doesn't exist yet — fresh DB. No backup needed.
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Whether an installation about to start should snapshot its database first.
 *
 * This used to ask "did the MAJOR digit increase?", which is the wrong
 * question: migrations do not care about the digit that moved. The 2.4.0 ->
 * 2.5.0 upgrade applied SEVEN migrations and was skipped, so the release that
 * most needed a snapshot ran without one (#246).
 *
 * The question that matters is "is an EXISTING installation about to run a
 * different build than the one it last ran?" — any version change on a
 * database that already has migrations. A patch release with no migrations
 * then takes a redundant snapshot, which is cheap insurance next to a failed
 * schema change with no way back.
 *
 * Pure and exported so the rule is testable without a database or a version
 * file; `maybeRunPreMigrationBackup` supplies the IO.
 */
export function shouldBackupBeforeMigrating(input: {
  previousVersion: string | null;
  currentVersion: string;
  hasExistingMigrations: boolean;
}): { backup: boolean; reason: string } {
  const { previousVersion, currentVersion, hasExistingMigrations } = input;

  if (!hasExistingMigrations) {
    // Nothing to lose yet.
    return { backup: false, reason: "Fresh install (no migrations applied yet)" };
  }

  if (previousVersion === null) {
    // The app shipped before the last-version marker existed, but the database
    // carries data and new migrations are pending. This is the most important
    // upgrade case and the one we can least afford to miss.
    return {
      backup: true,
      reason: `First upgrade with a last-version marker (existing data, no marker file) -> ${currentVersion}`,
    };
  }

  if (previousVersion === currentVersion) {
    // A plain container restart. Snapshotting every restart would fill the
    // disk with copies, none of which precedes a migration.
    return { backup: false, reason: `Same version ${currentVersion}; not an upgrade` };
  }

  return {
    backup: true,
    reason: `Version change ${previousVersion} -> ${currentVersion} on an existing install`,
  };
}

export async function maybeRunPreMigrationBackup(): Promise<UpgradeBackupContext> {
  const currentVersion = getCurrentVersion();
  const previousVersion = getLastDeployedVersion();

  const hasMigrations = await hasExistingMigrations();
  const decision = shouldBackupBeforeMigrating({
    previousVersion,
    currentVersion,
    hasExistingMigrations: hasMigrations,
  });

  const firstUpgradeFromPreMarker = previousVersion === null && hasMigrations;
  const shouldBackup = decision.backup;

  const ctx: UpgradeBackupContext = {
    previousVersion,
    currentVersion,
    shouldBackup,
    firstUpgradeFromPreMarker,
    backupCreated: null,
    backupError: null,
    versionSkew: null,
    reason: decision.reason,
  };

  if (!shouldBackup) {
    logger.info({
      operation: "upgrade_backup_skip",
      message: `${decision.reason}; skipping pre-migration backup`,
      previousVersion,
      currentVersion,
    });
    return ctx;
  }

  const reason = decision.reason;

  logger.info({
    operation: "upgrade_backup_start",
    message: `${reason}; creating pre-migration backup`,
    previousVersion,
    currentVersion,
    firstUpgradeFromPreMarker,
  });

  // BEFORE the attempt, so the failure message can name the reason rather than
  // only the symptom. It never throws and abstains when either version cannot
  // be read — see `pgDumpSkew.ts`.
  ctx.versionSkew = await detectPgDumpSkew();
  if (ctx.versionSkew) {
    logger.warn({
      operation: "upgrade_backup_pg_version_skew",
      message: "pg_dump and the server disagree on major version",
      detail: ctx.versionSkew,
    });
  }

  fs.mkdirSync(BACKUP_PATH, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  const safeVersion = currentVersion.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filename = `pre-v${safeVersion}-upgrade-${timestamp}.sql`;
  const outputPath = path.join(BACKUP_PATH, filename);

  try {
    await createDatabaseDump(outputPath);
    ctx.backupCreated = outputPath;
    logger.info({
      operation: "upgrade_backup_success",
      message: "Pre-migration backup created",
      outputPath,
    });
  } catch (error) {
    ctx.backupError = error instanceof Error ? error.message : "Unknown error";
    logger.error({
      operation: "upgrade_backup_error",
      message:
        "Pre-migration backup failed on a version change. The caller decides " +
        "whether to boot — see preMigrationOutcome.",
      previousVersion,
      currentVersion,
      error: { message: ctx.backupError },
    });
  }

  return ctx;
}

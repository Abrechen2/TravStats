import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import logger from "./logger";
import { createDatabaseDump } from "../services/backup/backupDatabase";

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
}

/**
 * The runtime version of the running container — APP_VERSION env wins
 * (set by docker-compose for byte-identical RC promotion), then
 * BUILD_VERSION env, then the VERSION file baked into the image.
 */
export function getCurrentVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.trim();
  if (process.env.BUILD_VERSION) return process.env.BUILD_VERSION.trim();
  if (fs.existsSync(VERSION_FILE)) {
    return fs.readFileSync(VERSION_FILE, "utf-8").trim();
  }
  return "unknown";
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
 * Parse the leading numeric major from a semver-ish string. Returns null
 * if the input does not start with a digit. Examples:
 *   "1.2.1"             -> 1
 *   "2.0.0-beta.4"      -> 2
 *   "v2.0.0-rc.1"       -> 2
 *   "unknown" / ""      -> null
 */
export function parseMajor(version: string): number | null {
  const stripped = version.replace(/^v/i, "").trim();
  const match = stripped.match(/^(\d+)\./);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
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
 * Failure modes are deliberately soft: if the backup fails (Docker
 * socket unavailable, pg_dump missing, no disk space) we log a clear
 * warning and continue. Refusing to migrate on backup failure would
 * paint users into a corner; the migration itself stays the bottleneck.
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
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"`,
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

  fs.mkdirSync(BACKUP_PATH, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
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
    logger.warn({
      operation: "upgrade_backup_error",
      message:
        "Pre-migration backup failed; continuing with migration anyway. " +
        "The user may have an unrecoverable state if migrations break.",
      previousVersion,
      currentVersion,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }

  return ctx;
}

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
  majorBumped: boolean;
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
 * version that last ran on this data volume to the version we are
 * about to start. If the major number increased (e.g. 1.x -> 2.x) we
 * snapshot the database to /app/data/backups/pre-vX-upgrade-<ts>.sql
 * BEFORE any migration runs, so a failed upgrade leaves a recoverable
 * state right next to the running install.
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

export async function maybeRunPreMigrationBackup(): Promise<UpgradeBackupContext> {
  const currentVersion = getCurrentVersion();
  const previousVersion = getLastDeployedVersion();

  const prevMajor = previousVersion ? parseMajor(previousVersion) : null;
  const currMajor = parseMajor(currentVersion);
  const explicitMajorBump =
    prevMajor !== null && currMajor !== null && currMajor > prevMajor;

  // Pre-marker installs: app shipped before this last-version file was
  // introduced. No file exists, but the DB carries existing data and
  // we are about to run new migrations. Treat as a major bump even
  // though we cannot prove it from the version file — the alternative
  // is missing the most important upgrade case (1.x -> 2.x without an
  // intermediate version that would have written the marker).
  const firstUpgradeFromPreMarker =
    previousVersion === null && (await hasExistingMigrations());

  const majorBumped = explicitMajorBump || firstUpgradeFromPreMarker;

  const ctx: UpgradeBackupContext = {
    previousVersion,
    currentVersion,
    majorBumped,
    firstUpgradeFromPreMarker,
    backupCreated: null,
  };

  if (!majorBumped) {
    logger.info({
      operation: "upgrade_backup_skip",
      message: previousVersion
        ? "No major-version bump detected; skipping pre-migration backup"
        : "Fresh install detected; skipping pre-migration backup",
      previousVersion,
      currentVersion,
    });
    return ctx;
  }

  const reason = firstUpgradeFromPreMarker
    ? `First upgrade with a last-version marker (existing data, no marker file) -> ${currentVersion}`
    : `Major version bump ${previousVersion} -> ${currentVersion}`;

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

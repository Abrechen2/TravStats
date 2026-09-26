import logger from "../../utils/logger";
import { isValidZone } from "./zonedParts";

/**
 * The zone each scheduled job's cron expression is read in (ADR 0002 D4).
 *
 * node-cron reads an expression in the HOST's zone unless it is given one.
 * The Docker image runs with `TZ=${TZ:-UTC}`, so a self-hosted instance that
 * set `TZ` moved every "3 AM UTC" job by its offset — and twice a year by
 * another hour — without a line in any log. Every job now names its zone.
 *
 * Maintenance jobs run in UTC: their times were chosen as UTC and only have to
 * stay apart from each other. The backup is the one job a person schedules
 * against their own night, so its zone is an admin setting
 * (`AdminSettings.backupZone`, owner decision 2026-09-26, plan open point 2)
 * whose default is the zone it has always run in — the host's, read once at
 * boot — so an instance that upgrades keeps its backup hour. The scheduler
 * hands the stored value in (`setAdminBackupZone`) whenever it (re)schedules;
 * `/health` reports the effective zone.
 */

export type SchedulerJob =
  | "airlineLogoRefresh"
  | "dataQualitySweep"
  | "dawarichCountryDaySweep"
  | "documentSweep"
  | "flightUpdate"
  | "historicalEnrichment"
  | "logRetention"
  | "photoJourneyScan"
  | "placeAddressBackfill"
  | "statusSweep"
  | "stayFxBackfill"
  | "usageStats"
  | "reminders"
  | "backup";

export type BackupZoneSource = "admin" | "host" | "default-utc";

export interface BackupZone {
  zone: string;
  source: BackupZoneSource;
}

let backupZoneAtBoot: BackupZone | null = null;
let adminBackupZone: string | null = null;

/**
 * The zone the backup job has always run in: the zone this process adopted
 * from the host (`TZ`, or the system zone where `TZ` is unset). Resolved once
 * and logged, so a later change of `TZ` in a running process cannot move it.
 * It is the default of the admin setting.
 */
export function hostBackupZone(): BackupZone {
  if (backupZoneAtBoot) return backupZoneAtBoot;
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  backupZoneAtBoot = isValidZone(host)
    ? { zone: host, source: "host" }
    : { zone: "UTC", source: "default-utc" };
  logger.info({
    operation: "scheduler_backup_zone",
    message: "Backup schedule zone resolved",
    context: { ...backupZoneAtBoot, hostTz: process.env.TZ ?? null },
  });
  return backupZoneAtBoot;
}

/**
 * Records the admin's backup zone (null = follow the host). A name this
 * runtime does not know is not adopted: the host zone is used and the log
 * says so, rather than node-cron throwing at schedule time.
 */
export function setAdminBackupZone(zone: string | null): void {
  if (zone !== null && !isValidZone(zone)) {
    logger.warn({
      operation: "scheduler_backup_zone_invalid",
      message: "Stored backup zone is not a known zone; the host zone is used",
      context: { zone },
    });
    adminBackupZone = null;
    return;
  }
  adminBackupZone = zone;
}

/** The zone the backup runs in: the admin's choice, else the host's. */
export function backupZone(): BackupZone {
  return adminBackupZone ? { zone: adminBackupZone, source: "admin" } : hostBackupZone();
}

/** The zone a job's cron expression is read in. */
export function schedulerZone(job: SchedulerJob): string {
  return job === "backup" ? backupZone().zone : "UTC";
}

/** Test hook: forget the boot-time backup zone and the admin's choice. */
export function resetBackupZoneForTests(): void {
  backupZoneAtBoot = null;
  adminBackupZone = null;
}

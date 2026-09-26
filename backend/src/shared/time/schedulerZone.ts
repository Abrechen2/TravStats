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
 * against their own night, so it keeps the zone it has always run in — the
 * host's, read once at boot (owner decision, plan open point 2). That is the
 * default of an admin setting a later phase adds; until then it is not
 * configurable in the UI, only visible on `/health`.
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

export type BackupZoneSource = "host" | "default-utc";

export interface BackupZone {
  zone: string;
  source: BackupZoneSource;
}

let backupZoneAtBoot: BackupZone | null = null;

/**
 * The zone the backup job has always run in: the zone this process adopted
 * from the host (`TZ`, or the system zone where `TZ` is unset). Resolved once
 * and logged, so a later change of `TZ` in a running process cannot move it.
 */
export function backupZone(): BackupZone {
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

/** The zone a job's cron expression is read in. */
export function schedulerZone(job: SchedulerJob): string {
  return job === "backup" ? backupZone().zone : "UTC";
}

/** Test hook: forget the boot-time backup zone. */
export function resetBackupZoneForTests(): void {
  backupZoneAtBoot = null;
}

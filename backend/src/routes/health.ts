import type { Request, Response } from "express";
import { backupZone } from "../shared/time/schedulerZone";
import { zoneSelfCheckResult } from "../shared/time/zoneOf";
import { syncSchemaCheckResult } from "../services/sync/schemaCheck";
import { appVersion } from "../utils/version";

/**
 * Health check — mounted at both `/health` (legacy, used by the Dockerfile
 * HEALTHCHECK and the nginx upstream probe) and `/api/v1/health` (versioned,
 * matches the public-API URL convention documented for external callers).
 *
 * `degraded` when the boot self-check found the time zone lookup broken
 * (shared/time/zoneOf.ts). Still a 200: the process serves requests and a
 * restart would not fix a broken dependency, but a probe that reads the body
 * sees it, instead of the server reading every local time as UTC in silence.
 *
 * `degraded` as well when the sync feed's database triggers are missing
 * (`services/sync/schemaCheck.ts`, forgejo#157): the Companion is then told
 * "nothing changed" after every edit, and a probe should see that.
 *
 * `scheduler.backupZone` is the zone the backup cron runs in — the admin's
 * setting, or the host's read once at boot when none is set
 * (shared/time/schedulerZone.ts). Every other job runs in
 * UTC. Shown here because a backup that moved by an hour is otherwise only
 * noticed when somebody looks at the timestamps.
 */
export function healthHandler(_req: Request, res: Response): void {
  const timezone = zoneSelfCheckResult();
  const timezoneLookup = timezone === null ? "pending" : timezone.ok ? "ok" : "failed";
  const sync = syncSchemaCheckResult();
  const syncTriggers = sync === null ? "pending" : sync.ok ? "ok" : "failed";
  res.json({
    status: timezoneLookup === "failed" || syncTriggers === "failed" ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    version: appVersion,
    checks: { timezoneLookup, syncTriggers },
    scheduler: { backupZone: backupZone().zone },
  });
}

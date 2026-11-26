/**
 * Public-URL reachability check (readiness spec 2026-11-14 §12).
 *
 * Once a day it runs the same probe as the admin's button when a public URL is
 * set and outbound traffic is allowed; `runPublicUrlCheck` returns without a
 * stored result in the other two cases, so the item then stays `unknown`.
 *
 * 05:35 UTC, off the hour and after the 05:15 WebDAV sync (slot table in
 * dataQualitySweepScheduler.ts). Deliberately NOT run once at start, unlike its
 * neighbours: at boot the server is not yet listening, so a probe of its own
 * public address would read "unreachable" for a perfectly healthy instance.
 * Never triggered by a login or by `GET /readiness`.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { runPublicUrlCheck } from "../services/readiness/publicUrlProbe";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";
import { runHeavyJob } from "../services/jobs/heavySlot";

const CRON_EXPRESSION = "35 5 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runPublicUrlCheckJob(): Promise<void> {
  try {
    const result = await runPublicUrlCheck();
    logger.info({
      operation: "public_url_check_done",
      ok: result.ok,
      errorCode: result.errorCode,
      httpStatus: result.httpStatus,
    });
  } catch (error) {
    // Nothing was stored, so the item keeps its previous result until it ages out to `unknown`.
    logger.warn({
      operation: "public_url_check_failed",
      error: { message: error instanceof Error ? error.message : "unknown" },
    });
  }
}

export function startPublicUrlCheckScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runHeavyJob("publicUrlCheck", () => runPublicUrlCheckJob());
    },
    { timezone: schedulerZone("publicUrlCheck") }
  );
  logger.info({ operation: "public_url_check_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopPublicUrlCheckScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

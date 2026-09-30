/**
 * Lodging FX backfill scheduler — see `services/lodging/stayFxBackfill.ts`.
 *
 * Once shortly after boot (so an upgrade repairs existing rows the same day),
 * then daily at 03:30 UTC: after the place address backfill at 03:20, before
 * log retention at 03:45 and the data-quality sweep at 04:10.
 */

import cron from "node-cron";
import logger from "../utils/logger";
import { backfillMissingStayFx } from "../services/lodging/stayFxBackfill";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "30 3 * * *";
/** Out of the way of startup (migrations, seeds, the first requests). */
const BOOT_DELAY_MS = 3 * 60 * 1000;

let schedulerTask: cron.ScheduledTask | null = null;
let bootTimer: NodeJS.Timeout | null = null;

async function runLogged(operation: string): Promise<void> {
  try {
    await backfillMissingStayFx();
  } catch (error) {
    logger.warn({ operation, error }, "Lodging FX backfill failed");
  }
}

export function startStayFxBackfillScheduler(): void {
  if (schedulerTask) return;
  bootTimer = setTimeout(() => void runLogged("stay_fx_backfill_boot_error"), BOOT_DELAY_MS);
  bootTimer.unref?.();
  schedulerTask = cron.schedule(CRON_EXPRESSION, () => runLogged("stay_fx_backfill_error"), {
    timezone: schedulerZone("stayFxBackfill"),
  });
  logger.info(
    { operation: "stay_fx_backfill_scheduler_started", cron: CRON_EXPRESSION },
    "lodging FX backfill scheduler started"
  );
}

export function stopStayFxBackfillScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
  schedulerTask?.stop();
  schedulerTask = null;
}

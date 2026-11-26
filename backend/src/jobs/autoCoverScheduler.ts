/**
 * Nightly automatic covers: every account's cover-less trips with photos get a
 * look (`services/coverSuggestions/autoCover.ts`). Photo links made during the day
 * also queue a run, so this is the safety net, not the only path.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import { runAutoCoverSweep } from "../services/coverSuggestions/autoCover";
import { schedulerZone } from "../shared/time/schedulerZone";
import { runHeavyJob } from "../services/jobs/heavySlot";

// 4 AM UTC, after the 3 AM logo sweep.
const CRON_EXPRESSION = "0 4 * * *";

let schedulerTask: ScheduledTask | null = null;

export function startAutoCoverScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      runHeavyJob("autoCover", () => runAutoCoverSweep()).catch((error: unknown) => {
        logger.error({ message: "auto_cover_sweep_failed", error });
      });
    },
    { timezone: schedulerZone("autoCover") }
  );
  logger.info({ message: "auto_cover_scheduler_started", context: { cron: CRON_EXPRESSION } });
}

export function stopAutoCoverScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

/** Daily sweep: a place whose planned visit has passed becomes visited. */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import { sweepElapsedPlannedVisits } from "../services/places/elapsedPlanSweep";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "30 4 * * *";

let schedulerTask: ScheduledTask | null = null;

export function startElapsedPlanSweepScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    async () => {
      try {
        await sweepElapsedPlannedVisits();
      } catch (error) {
        logger.warn({ operation: "elapsed_plan_sweep_error", error }, "Elapsed plan sweep failed");
      }
    },
    { timezone: schedulerZone("elapsedPlanSweep") }
  );
  logger.info({ operation: "elapsed_plan_sweep_scheduler_started" }, "elapsed plan sweep started");
}

export function stopElapsedPlanSweepScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

/**
 * The paced poll of the plugins' maintenance proposals and notices (owner 2026-11-26): every 15
 * minutes it refreshes the registrations whose copy is older than 6 h or was marked due by new
 * stops (`services/plugins/maintenanceCache.ts`). The inbox reads the copy, never the plugins.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { refreshDueMaintenanceCaches } from "../services/plugins/maintenanceCache";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "*/15 * * * *";
let schedulerTask: ScheduledTask | null = null;
let running = false;

export async function runPluginMaintenancePoll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await refreshDueMaintenanceCaches();
  } catch (error) {
    logger.warn(
      {
        operation: "plugin_maintenance_poll_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      "Plugin maintenance poll failed; the next run retries"
    );
  } finally {
    running = false;
  }
}

export function startPluginMaintenanceScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, () => void runPluginMaintenancePoll(), {
    timezone: schedulerZone("pluginMaintenance"),
  });
  logger.info(
    { operation: "plugin_maintenance_scheduler_started", cron: CRON_EXPRESSION },
    "Plugin maintenance poll started"
  );
}

export function stopPluginMaintenanceScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

/**
 * The vessel poller's clock (2026-11-22): every ten minutes, one AIS read per
 * ferry crossing or cruise in progress — see `services/vessel/vesselPoller.ts`.
 * A run that is still waiting on sockets when the next one is due is skipped.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import { pollVesselsOnce } from "../services/vessel/vesselPoller";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "*/10 * * * *";

let task: ScheduledTask | null = null;
let running = false;

export async function runVesselTrackPoll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await pollVesselsOnce();
  } catch (error) {
    logger.warn({
      operation: "vessel.poll.run_failed",
      message: error instanceof Error ? error.message : "unknown error",
    });
  } finally {
    running = false;
  }
}

export function startVesselTrackScheduler(): void {
  if (task) return;
  task = cron.schedule(CRON_EXPRESSION, () => void runVesselTrackPoll(), {
    timezone: schedulerZone("vesselTrack"),
  });
}

export function stopVesselTrackScheduler(): void {
  task?.stop();
  task = null;
}

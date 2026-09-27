import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";
import { checkFlightReminders } from "./reminders/flightReminders";
import { checkCruiseReminders } from "./reminders/cruiseReminders";
import { checkRailReminders } from "./reminders/railReminders";
import { checkLodgingCheckInReminders } from "./reminders/lodgingReminders";

/**
 * Orchestrates the departure-reminder scheduler (2026-09-27 redesign: emails
 * got a shared branded shell and content, and extended from flight-only to
 * cruise, rail and lodging). Each domain owns its window-matching and dedup
 * logic in its own file under `./reminders/` — kept apart so no single file
 * grows past the 800-line ratchet, and so a domain's correctness fix (e.g.
 * the LEGACY_FAKE_UTC normalisation flights need and rail/cruise do not)
 * stays local to that domain.
 */

let scheduledTask: ScheduledTask | null = null;

async function checkAndSendReminders(): Promise<void> {
  logger.debug({ operation: "reminder_scheduler_run", message: "Checking departure reminders" });

  const now = new Date();

  // Independent per domain: one domain's query failure (logged inside each
  // checker) must not block the others.
  await Promise.all([
    checkFlightReminders(now),
    checkCruiseReminders(now),
    checkRailReminders(now),
    checkLodgingCheckInReminders(now),
  ]);
}

export function startReminderScheduler(): void {
  if (scheduledTask) {
    logger.warn({
      operation: "reminder_scheduler_already_running",
      message: "Reminder scheduler is already running",
    });
    return;
  }

  // Run every 15 minutes
  scheduledTask = cron.schedule(
    "*/15 * * * *",
    () => {
      checkAndSendReminders().catch((error: unknown) => {
        logger.error({
          operation: "reminder_scheduler_unhandled_error",
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
      });
    },
    { timezone: schedulerZone("reminders") }
  );

  logger.info({
    operation: "reminder_scheduler_started",
    message: "Departure reminder scheduler started (flight/cruise/rail/lodging, every 15 min)",
  });
}

export function stopReminderScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info({
      operation: "reminder_scheduler_stopped",
      message: "Departure reminder scheduler stopped",
    });
  }
}

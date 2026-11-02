/**
 * Mail intake scheduler (forgejo#313): every 5 minutes it reads each enabled
 * mailbox, and keeps an IDLE connection open for up to ten of them so new mail
 * is picked up in seconds (see services/mailIntake/idleWatchers.ts). Both cron
 * and IDLE reach the same `runSource`, which refuses to overlap itself.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { prisma } from "../db";
import { POLL_CRON } from "../services/mailIntake/constants";
import { ensureWatchers, stopWatchers } from "../services/mailIntake/idleWatchers";
import { runSource } from "../services/mailIntake/runSource";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

let task: ScheduledTask | null = null;

export async function runMailIntakePoll(): Promise<void> {
  try {
    const sources = await prisma.mailIntakeSource.findMany({
      where: { enabled: true },
      select: { id: true },
      orderBy: { lastRunAt: { sort: "asc", nulls: "first" } },
    });
    for (const { id } of sources) await runSource(id);
    await ensureWatchers();
  } catch (error) {
    logger.warn({ operation: "mail_intake_poll_failed", err: error });
  }
}

export function startMailIntakeScheduler(): void {
  if (task) return;
  task = cron.schedule(POLL_CRON, () => void runMailIntakePoll(), {
    timezone: schedulerZone("mailIntake"),
  });
}

export function stopMailIntakeScheduler(): void {
  task?.stop();
  task = null;
  stopWatchers();
}

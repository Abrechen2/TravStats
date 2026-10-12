import { schedulerZone } from "../shared/time/schedulerZone";
import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "../db";
import { reserveScan, scanStays } from "../services/dawarich/stays/scan";
import logger from "../utils/logger";
let task: ScheduledTask | null = null;
export async function runDawarichStaySweep(): Promise<void> {
  const accounts = await prisma.dawarichStayScan.findMany({
    where: { enabled: true },
    select: { userId: true },
  });
  for (const { userId } of accounts) {
    try {
      await reserveScan(userId);
      await scanStays(userId);
    } catch {
      logger.warn(
        { operation: "dawarich_stay_scan_failed", userId },
        "Dawarich stay scan could not run; see account scan state"
      );
    }
  }
}
export function startDawarichStayScheduler(): void {
  if (task) return;
  task = cron.schedule(
    "15 */6 * * *",
    async () => {
      try {
        await runDawarichStaySweep();
      } catch {
        logger.warn({ operation: "dawarich_stay_sweep_failed" }, "Dawarich stay scan sweep failed");
      }
    },
    { timezone: schedulerZone("dawarichStayScan") }
  );
}
export function stopDawarichStayScheduler(): void {
  task?.stop();
  task = null;
}

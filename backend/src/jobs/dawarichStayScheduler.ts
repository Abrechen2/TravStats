import { schedulerZone } from "../shared/time/schedulerZone";
import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "../db";
import { reserveScan, scanStays } from "../services/dawarich/stays/scan";
import { DAWARICH_PROVIDER_WHERE } from "../services/locationProvider/kinds";
import logger from "../utils/logger";
import { AppError } from "../middleware/errorHandler";
let task: ScheduledTask | null = null;
export async function runDawarichStaySweep(): Promise<void> {
  // An account with stay suggestions switched off (forgejo#306) is not even
  // attempted: reserveScan would refuse it anyway, but as a warning every six hours.
  // Nor one whose location source is not Dawarich (TravTrack plan S3) — that
  // gate is this schedule's alone: "scan now" (`routes/dawarichStays.ts`) is the
  // person asking, and runs whatever the provider. Market visits ride inside
  // `scanStays`, so they follow it too.
  const accounts = await prisma.dawarichStayScan.findMany({
    where: {
      enabled: true,
      user: { settings: { is: { staySuggestionsEnabled: true, ...DAWARICH_PROVIDER_WHERE } } },
    },
    select: { userId: true },
  });
  for (const { userId } of accounts) {
    try {
      await reserveScan(userId);
      await scanStays(userId);
    } catch (err) {
      logScanFailure(userId, err);
    }
  }
}
/**
 * A refusal the account state already explains (scan disabled, already running,
 * no connection) stays a warning. Anything else is logged WITH its cause: the
 * bare catch used to turn a database outage into the same line as a paused scan.
 */
function logScanFailure(userId: string, err: unknown): void {
  if (err instanceof AppError && err.statusCode < 500) {
    logger.warn(
      { operation: "dawarich_stay_scan_failed", userId, code: err.code ?? null },
      "Dawarich stay scan could not run; see account scan state"
    );
    return;
  }
  logger.error(
    { operation: "dawarich_stay_scan_failed", userId, err },
    "Dawarich stay scan failed"
  );
}
export function startDawarichStayScheduler(): void {
  if (task) return;
  task = cron.schedule(
    "15 */6 * * *",
    async () => {
      try {
        await runDawarichStaySweep();
      } catch (err) {
        logger.error(
          { operation: "dawarich_stay_sweep_failed", err },
          "Dawarich stay scan sweep failed"
        );
      }
    },
    { timezone: schedulerZone("dawarichStayScan") }
  );
}
export function stopDawarichStayScheduler(): void {
  task?.stop();
  task = null;
}

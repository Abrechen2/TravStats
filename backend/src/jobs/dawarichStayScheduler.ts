import { schedulerZone } from "../shared/time/schedulerZone";
import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "../db";
import { reserveScan, scanStays } from "../services/dawarich/stays/scan";
import { STAY_SCAN_PROVIDER_WHERE } from "../services/locationProvider/kinds";
import { travTrackInstanceOn } from "../services/travtrack/availability";
import logger from "../utils/logger";
import { AppError } from "../middleware/errorHandler";
let task: ScheduledTask | null = null;
/**
 * Whether this sweep also scans TravTrack accounts (TravTrack plan E3). A
 * switch that cannot be read counts as off for this sweep: Dawarich scans do
 * not depend on TravTrack, so they go ahead, and the TravTrack accounts wait
 * for the next sweep.
 */
async function travTrackOnForSweep(): Promise<boolean> {
  try {
    return await travTrackInstanceOn();
  } catch (err) {
    logger.warn(
      { operation: "dawarich_stay_sweep_travtrack_switch_unreadable", err },
      "TravTrack switch could not be read; this sweep scans Dawarich accounts only"
    );
    return false;
  }
}
export async function runDawarichStaySweep(): Promise<void> {
  // An account with stay suggestions switched off (forgejo#306) is not even
  // attempted: reserveScan would refuse it anyway, but as a warning every six hours.
  // Nor one whose location source is neither Dawarich (TravTrack plan S3) nor
  // — while the instance's TravTrack is on — TravTrack (E3). That gate is this
  // schedule's alone: "scan now" (`routes/dawarichStays.ts`) is the person
  // asking. Market visits ride inside `scanStays`, so they follow it too.
  const providerWhere = (await travTrackOnForSweep())
    ? STAY_SCAN_PROVIDER_WHERE.travTrackOn
    : STAY_SCAN_PROVIDER_WHERE.travTrackOff;
  const accounts = await prisma.dawarichStayScan.findMany({
    where: {
      enabled: true,
      user: { settings: { is: { staySuggestionsEnabled: true, ...providerWhere } } },
    },
    select: { userId: true },
  });
  for (const { userId } of accounts) {
    try {
      // Scheduled: each step re-checks that the scan's source is still the provider.
      await reserveScan(userId, new Date(), { scheduled: true });
      await scanStays(userId, { scheduled: true });
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

/**
 * Ferry sea-route backfill (owner, 2026-10-21) — once per boot, in bounded
 * batches. What is routed, what is kept and when a crossing is tried again is
 * in `services/ferry/ferryRouteBackfill.ts`.
 *
 * Not a cron: a crossing saved now is routed on save, so once the backlog is
 * done there is nothing to do. Resumable by construction: a routed crossing is
 * no longer a chord, and every other attempt is recorded per crossing
 * (`ferry_route_backfills`), so a restart halfway through takes up the rest.
 * A run stops after `MAX_PER_RUN` crossings; a larger backlog continues on the
 * next boot.
 */

import logger from "../utils/logger";
import {
  backfillFerrySeaRoutes,
  type BackfillOptions,
  type BackfillReport,
} from "../services/ferry/ferryRouteBackfill";

/** After the boot rush, like the other one-off sweeps. */
const BOOT_DELAY_MS = 5 * 60 * 1000;
/** Crossings per batch: each is one A* over the sea graph. */
export const BACKFILL_BATCH = 10;
/** At most this many crossings per boot. */
export const MAX_PER_RUN = 250;
/** A pause between batches, so the router never holds the CPU for long. */
const BATCH_PAUSE_MS = 5 * 1000;

let bootTimer: NodeJS.Timeout | null = null;
let stopped = false;
let running = false;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/** Batches until one finds nothing left to try, or the cap is reached. Exported for the test. */
export async function runFerryRouteBackfill({
  batchPauseMs = BATCH_PAUSE_MS,
  maxPerRun = MAX_PER_RUN,
  batch = BACKFILL_BATCH,
  ...scope
}: { batchPauseMs?: number; maxPerRun?: number; batch?: number } & Pick<
  BackfillOptions,
  "userId" | "now"
> = {}): Promise<BackfillReport> {
  const total: BackfillReport = { routed: 0, straight: 0, failed: 0, examined: 0 };
  if (running) return total;
  running = true;
  try {
    // One run's memory: a crossing tried (or skipped as no longer a chord)
    // is not picked again in the same run.
    const attempted = new Set<string>();
    while (!stopped && total.examined < maxPerRun) {
      const report = await backfillFerrySeaRoutes({
        limit: Math.min(batch, maxPerRun - total.examined),
        attempted,
        ...scope,
      });
      if (report.examined === 0) break;
      total.routed += report.routed;
      total.straight += report.straight;
      total.failed += report.failed;
      total.examined += report.examined;
      await pause(batchPauseMs);
    }
  } finally {
    running = false;
  }
  if (total.examined > 0) {
    logger.info(
      { operation: "ferry_route_backfill", ...total },
      "Ferry sea-route backfill finished"
    );
  }
  return total;
}

export function startFerryRouteBackfillScheduler(): void {
  if (bootTimer) return;
  stopped = false;
  bootTimer = setTimeout(() => {
    void runFerryRouteBackfill().catch((error) => {
      logger.warn(
        { operation: "ferry_route_backfill_error", error },
        "Ferry sea-route backfill failed"
      );
    });
  }, BOOT_DELAY_MS);
  bootTimer.unref?.();
}

export function stopFerryRouteBackfillScheduler(): void {
  stopped = true;
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
}

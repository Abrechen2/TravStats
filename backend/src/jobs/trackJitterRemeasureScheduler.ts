/**
 * Track jitter re-measure (forgejo#319) — once per boot, in bounded batches.
 *
 * Recordings stored before the jitter filter carry `jitterDropped = NULL`.
 * Where the raw points still exist (a Dawarich pull) they are re-measured by
 * `remeasureStoredTracks`; everything else is left as recorded, see that
 * module for which source keeps what. Not a cron: there is nothing to do
 * once the backlog is done, and a new recording is filtered on its way in.
 *
 * Resumable by construction: a re-measured row has a number, so a restart
 * halfway through takes up the rows still NULL. A row that cannot be
 * re-measured (no Dawarich, its points changed) is tried once per boot.
 */

import logger from "../utils/logger";
import { remeasureStoredTracks, type RemeasureReport } from "../services/tracks/jitterRemeasure";

/** After the boot rush, like the other one-off sweeps. */
const BOOT_DELAY_MS = 5 * 60 * 1000;
/** Rows per batch: one Dawarich request each, so a batch is a minute at most. */
export const REMEASURE_BATCH = 25;
/** A pause between batches, so a long backlog never monopolises a user's Dawarich. */
const BATCH_PAUSE_MS = 30 * 1000;

let bootTimer: NodeJS.Timeout | null = null;
let stopped = false;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/** Batches until one finds nothing left to try. Exported for the test. */
export async function runTrackJitterRemeasure(
  batchPauseMs = BATCH_PAUSE_MS,
  options: Pick<Parameters<typeof remeasureStoredTracks>[0], "clientFor"> = {}
): Promise<RemeasureReport> {
  const attempted = new Set<string>();
  const total: RemeasureReport = {
    remeasured: 0,
    skipped: { notConfigured: 0, sourceChanged: 0, unavailable: 0 },
    examined: 0,
  };
  for (;;) {
    if (stopped) break;
    const batch = await remeasureStoredTracks({ limit: REMEASURE_BATCH, attempted, ...options });
    if (batch.examined === 0) break;
    total.remeasured += batch.remeasured;
    total.examined += batch.examined;
    for (const key of Object.keys(total.skipped) as Array<keyof RemeasureReport["skipped"]>) {
      total.skipped[key] += batch.skipped[key];
    }
    await pause(batchPauseMs);
  }
  if (total.examined > 0) {
    logger.info(
      { operation: "track_jitter_remeasure", ...total },
      "Track jitter re-measure finished"
    );
  }
  return total;
}

export function startTrackJitterRemeasureScheduler(): void {
  if (bootTimer) return;
  stopped = false;
  bootTimer = setTimeout(() => {
    void runTrackJitterRemeasure().catch((error) => {
      logger.warn(
        { operation: "track_jitter_remeasure_error", error },
        "Track jitter re-measure failed"
      );
    });
  }, BOOT_DELAY_MS);
  bootTimer.unref?.();
}

export function stopTrackJitterRemeasureScheduler(): void {
  stopped = true;
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
}

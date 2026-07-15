/**
 * Airline Logo Refresh Scheduler
 *
 * Stale-while-revalidate (see airlineLogoService.resolveAirlineLogo) only
 * refreshes a cached logo when somebody actually requests it. This nightly
 * sweep covers the rest of the cache, so an airline that rebrands reaches
 * every instance even if nobody opened one of its flights that month.
 */

import cron from "node-cron";
import logger from "../utils/logger";
import { getCachedLogoEntry, isStale, listCachedLogoKeys } from "../services/airlineLogo/logoCache";
import {
  refreshLogo,
  LOGO_MAX_AGE_MS,
  RETRY_BACKOFF_MS,
} from "../services/airlineLogo/airlineLogoService";

// 3 AM UTC. node-cron reads the container clock, and both containers run
// TZ=UTC (see the timezone note in CLAUDE.local.md) — so this really is 3 AM UTC.
const CRON_EXPRESSION = "0 3 * * *";

// Sequential, with a breath between fetches: a cold instance can hold a few
// hundred keys, and firing them all at once would look like an attack.
const DELAY_BETWEEN_MS = 250;

let schedulerTask: cron.ScheduledTask | null = null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function sweepStaleLogos(): Promise<{ checked: number; refreshed: number }> {
  const keys = await listCachedLogoKeys();
  let refreshed = 0;

  for (const key of keys) {
    const entry = await getCachedLogoEntry(key);
    if (!entry) continue;
    if (!isStale(entry, LOGO_MAX_AGE_MS)) continue;
    // Staleness is measured from the last success; the backoff from the last
    // attempt. An upstream that failed an hour ago is not retried tonight.
    if (entry.lastAttemptAt !== null && Date.now() - entry.lastAttemptAt < RETRY_BACKOFF_MS) {
      continue;
    }
    try {
      if (await refreshLogo(key)) refreshed++;
    } catch (error) {
      // One bad key must not abort the sweep.
      logger.warn(
        {
          operation: "logo_sweep_key_failed",
          key,
          message: error instanceof Error ? error.message : "unknown error",
        },
        "airline logo refresh failed during sweep"
      );
    }
    await sleep(DELAY_BETWEEN_MS);
  }

  logger.info(
    { operation: "logo_sweep_done", checked: keys.length, refreshed },
    "airline logo refresh sweep complete"
  );
  return { checked: keys.length, refreshed };
}

export function startAirlineLogoRefreshScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, () => {
    void sweepStaleLogos();
  });
  logger.info(
    { operation: "logo_scheduler_started", cron: CRON_EXPRESSION },
    "airline logo refresh scheduler started"
  );
}

export function stopAirlineLogoRefreshScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

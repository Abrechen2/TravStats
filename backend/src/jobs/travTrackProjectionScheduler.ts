/**
 * TravTrack projections (TravTrack plan E6): every 15 minutes, each account
 * with dirty days — or with points the current country reducer has not seen —
 * gets its country days projected (`services/travtrack/countryProjection.ts`),
 * then its country questions asked (`services/locationEvidence/
 * countrySuggestions.ts`). Bounded per account by the projection's day budget
 * and the questions' cap (review focus 19).
 *
 * Only while the instance's TravTrack is on; switched off, nothing runs and the
 * dirty days wait. Accounts one after another, and a run never overlaps the
 * previous one. No run at boot: the first slot comes within 15 minutes.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { prisma } from "../db";
import { COUNTRY_DAY_REDUCER_VERSION } from "../services/dawarich/countryDaySweep";
import { getCountryResolver } from "../services/geo/countryFromCoordinates";
import { countrySuggestions } from "../services/locationEvidence/countrySuggestions";
import { travTrackInstanceOn } from "../services/travtrack/availability";
import { projectTravTrackCountryDays } from "../services/travtrack/countryProjection";
import { accountsWithDirtyDays, COUNTRY_DAYS_BIT } from "../services/travtrack/dirtyDays";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "*/15 * * * *";

let schedulerTask: ScheduledTask | null = null;
let running = false;

export type ProjectionRunOptions = {
  /** Injected by tests so the boundary file is not needed. */
  countryAt?: (lat: number, lon: number) => string | null;
};

export type ProjectionRunResult = { accounts: number; failed: number; questions: number };

/** Accounts holding points the current country reducer has not projected yet. */
async function accountsBehindReducer(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM users u
     WHERE EXISTS (SELECT 1 FROM travtrack_points p WHERE p.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM travtrack_derivation_state s
          WHERE s.user_id = u.id AND s.country_reducer_version >= ${COUNTRY_DAY_REDUCER_VERSION})
     ORDER BY u.id`;
  return rows.map((r) => r.id);
}

export async function runTravTrackProjections(
  options: ProjectionRunOptions = {}
): Promise<ProjectionRunResult> {
  const result: ProjectionRunResult = { accounts: 0, failed: 0, questions: 0 };
  if (!(await travTrackInstanceOn())) return result;
  const accounts = [
    ...new Set([
      ...(await accountsWithDirtyDays(COUNTRY_DAYS_BIT)),
      ...(await accountsBehindReducer()),
    ]),
  ].sort();
  if (accounts.length === 0) return result;
  // Loaded once per run: the boundary index is several megabytes.
  const countryAt = options.countryAt ?? (await getCountryResolver()).countryAt;
  for (const userId of accounts) {
    result.accounts += 1;
    try {
      const projected = await projectTravTrackCountryDays(userId, { countryAt });
      if (projected.status !== "done") {
        if (projected.status === "failed") result.failed += 1;
        continue;
      }
      result.questions += (await countrySuggestions(userId)).created;
    } catch (error) {
      // One account's failure is one account's: the next is still projected.
      result.failed += 1;
      logger.warn({
        operation: "travtrack_projections_account_failed",
        userId,
        // The name only: a message could carry a query's values.
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return result;
}

export function startTravTrackProjectionScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      if (running) return;
      running = true;
      void runTravTrackProjections()
        .then((result) => {
          if (result.accounts > 0)
            logger.info({ operation: "travtrack_projections_done", ...result });
        })
        .catch((error: unknown) =>
          logger.warn({
            operation: "travtrack_projections_failed",
            errorName: error instanceof Error ? error.name : "unknown",
          })
        )
        .finally(() => {
          running = false;
        });
    },
    { timezone: schedulerZone("travTrackProjections") }
  );
  logger.info({ operation: "travtrack_projections_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopTravTrackProjectionScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

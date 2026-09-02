/**
 * Data-Quality Sweep Scheduler
 *
 * The checks (`services/dataQuality/runner.ts`) shipped reachable from exactly
 * one place: a button in the inbox. An inbox nobody has opened yet therefore
 * stays empty for ever, which makes the feature answer a question only the
 * people who already suspect the answer will ask. This is the other half —
 * every account is looked at once a night whether anyone presses anything.
 *
 * A run only ever writes `data_quality_flags`. It touches no stat, no
 * achievement and no passport entry, so the worst a bad night can do is ask a
 * question badly.
 *
 * ## The slot, and its neighbours
 *
 * 04:10 UTC. Both containers run `TZ=UTC` (see the timezone note in
 * CLAUDE.local.md), so a cron expression here means what it says.
 *
 * | Time (UTC) | Job |
 * |---|---|
 * | 02:00 | historical enrichment; the daily/weekly/monthly backup |
 * | 03:00 | airline logo refresh sweep |
 * | 03:00–03:59 | usage-stats ping (jittered across the hour) |
 * | 03:20 | place address backfill |
 * | every :00 | hourly status sweep |
 * | **04:10** | **this** |
 *
 * The ordering is not just about avoiding contention. Two of those jobs write
 * the very columns these checks read, and reading them first would produce
 * questions about data that was about to be corrected anyway:
 *
 * - the **place address backfill** at 03:20 fills a missing `address` /
 *   `country`, and `addressCountryMismatch` abstains where either is absent —
 *   so running before it means the flag appears a day late, or worse, appears
 *   and then auto-resolves the following night for no reason the user can see;
 * - the **hourly status sweep** flips stay and flight statuses from their
 *   dates, and `lodgingEvidence` reads `status` to decide whether a house
 *   proves a night at all.
 *
 * Ten past the hour also keeps it off the top-of-hour status sweep rather than
 * racing it.
 */

import cron from "node-cron";

import { prisma } from "../db";
import { runDataQualityChecks } from "../services/dataQuality";
import logger from "../utils/logger";

const CRON_EXPRESSION = "10 4 * * *";

let schedulerTask: cron.ScheduledTask | null = null;

export interface DataQualitySweepResult {
  /** Accounts looked at. */
  users: number;
  /** Accounts whose run threw. The sweep continued past each of them. */
  failed: number;
  opened: number;
  reopened: number;
  autoResolved: number;
}

/**
 * Whose account is worth reading.
 *
 * All three checks derive from lodgings and places: flights and port calls only
 * ever contribute DATED evidence, which can suppress a finding but never
 * produce one. An account with nothing but flights can therefore be skipped
 * without changing a single flag.
 *
 * The third term is the one that is easy to leave out and wrong to. A user who
 * deleted their last lodging still owns the open flag it raised, and the runner
 * resolves a flag whose record is gone — but only if it is asked. Without this
 * an emptied account keeps a question about a record that no longer exists,
 * permanently, because it no longer qualifies for the sweep that would clear
 * it.
 */
async function eligibleUserIds(): Promise<string[]> {
  const [withLodgings, withPlaces, withOpenFlags] = await Promise.all([
    prisma.lodging.groupBy({ by: ["userId"] }),
    prisma.place.groupBy({ by: ["userId"] }),
    prisma.dataQualityFlag.groupBy({ by: ["userId"], where: { status: "open" } }),
  ]);

  const ids = new Set<string>();
  for (const group of [...withLodgings, ...withPlaces, ...withOpenFlags]) {
    ids.add(group.userId);
  }
  // Sorted so two nights' logs line up and a test can assert an order.
  return [...ids].sort();
}

/**
 * One pass over every eligible account.
 *
 * Accounts are handled one after another, and that sequencing IS the
 * concurrency limit — deliberately, rather than a tunable. Each run holds the
 * account's whole flight and lodging set in memory at once, and the Prisma pool
 * is process-wide and shared with whatever a user is doing at 04:10; fanning
 * out would trade a job nobody is waiting for against requests somebody is.
 *
 * One account's failure must not end the night for the accounts after it, so
 * each is wrapped. This is the same trade `sweepStaleLogos` makes for a bad
 * key.
 */
export async function runDataQualitySweep(): Promise<DataQualitySweepResult> {
  const userIds = await eligibleUserIds();

  const result: DataQualitySweepResult = {
    users: userIds.length,
    failed: 0,
    opened: 0,
    reopened: 0,
    autoResolved: 0,
  };

  for (const userId of userIds) {
    try {
      const summary = await runDataQualityChecks(userId);
      result.opened += summary.opened;
      result.reopened += summary.reopened;
      result.autoResolved += summary.autoResolved;
    } catch (error) {
      result.failed += 1;
      logger.warn(
        {
          operation: "data_quality_sweep_user_failed",
          userId,
          message: error instanceof Error ? error.message : String(error),
        },
        "Data-quality checks failed for one account — the sweep continues"
      );
    }
  }

  logger.info({ operation: "data_quality_sweep_done", ...result }, "Data-quality sweep complete");
  return result;
}

export function startDataQualitySweepScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDataQualitySweep();
    } catch (error) {
      // `runDataQualitySweep` already survives a single account; reaching here
      // means the eligibility query itself failed, which is a database problem
      // and not something tonight's sweep can do anything about.
      logger.warn(
        { operation: "data_quality_sweep_error", error },
        "Nightly data-quality sweep failed"
      );
    }
  });
  logger.info(
    { operation: "data_quality_sweep_scheduler_started", cron: CRON_EXPRESSION },
    "data quality sweep scheduler started"
  );
}

export function stopDataQualitySweepScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

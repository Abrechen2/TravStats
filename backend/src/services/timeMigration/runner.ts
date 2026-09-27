import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../adminSettingsRow";
import { runDataQualityChecks } from "../dataQuality/runner";
import { findRunningJob, jobErrorOf, startJob, type JobView } from "../jobs/jobRegistry";
import { zoneSelfCheckResult } from "../../shared/time/zoneOf";
import logger from "../../utils/logger";
import type { TableSummary } from "./core";
import { backfillCruises, backfillCruiseStops } from "./cruises";
import {
  backfillBirthdays,
  backfillJournal,
  backfillLodgingStays,
  backfillTrips,
} from "./dayColumns";
import { backfillFlights } from "./flights";
import { backfillPlaceVisits } from "./placeVisits";
import { backfillRail } from "./rail";
import { setBackfillRunState } from "./state";
import { backfillTripStops } from "./tripStops";

/**
 * The time-model backfill (ADR 0002 phase 3b): converts every row written
 * before the phase-2 write paths into the new time columns, once per
 * instance, at boot — after the airport zones were refreshed, because a
 * flight's zone is read from that catalogue.
 *
 * - Idempotent: each table module skips rows already filled (by a write path
 *   or a seed) and rows the ledger already holds, so a second run — or a run
 *   after a crash half-way — changes nothing that was done.
 * - Writes only the new columns and `time_migration_ledger`; undoing it is
 *   `undo-backfill.sql` beside the marker migration.
 * - Guesses nothing: what it cannot decide is an open ledger row, and a
 *   question in the owner's inbox (the data-quality check reads them).
 * - Runs as a job (`timeModel.backfill`), so the admin report can say it is
 *   running; the marker `AdminSettings.time_model_backfill_at` is set only
 *   when every table finished.
 */

export interface BackfillSummary {
  tables: Array<{ table: TableSummary["table"]; converted: number; open: number }>;
  /** Accounts whose inbox was refreshed because they have an open question. */
  accountsAsked: number;
}

/** Order matters once: trips read the zones the flights step just stored. */
const STEPS: Array<() => Promise<TableSummary>> = [
  backfillFlights,
  backfillRail,
  backfillPlaceVisits,
  backfillCruiseStops,
  backfillCruises,
  backfillTripStops,
  backfillTrips,
  backfillJournal,
  backfillLodgingStays,
  backfillBirthdays,
];

export async function runTimeModelBackfill(now: Date = new Date()): Promise<BackfillSummary> {
  const tables: BackfillSummary["tables"] = [];
  const asked = new Set<string>();
  for (const step of STEPS) {
    const summary = await step();
    tables.push({ table: summary.table, converted: summary.converted, open: summary.open });
    for (const userId of summary.usersWithOpen) asked.add(userId);
  }
  // The questions reach the inbox through the data-quality check; run it now
  // for the accounts that have one rather than waiting for the nightly sweep.
  for (const userId of asked) await runDataQualityChecks(userId, now);
  await prisma.adminSettings.update({
    where: { id: await ensureAdminSettingsRow() },
    data: { timeModelBackfillAt: now },
  });
  const summary = { tables, accountsAsked: asked.size };
  logger.info({
    operation: "time_model_backfill_done",
    message: "Time-model backfill finished",
    context: summary,
  });
  return summary;
}

/** The system's own jobs are owned by no user; nobody can read them via `/jobs/:id`. */
export const SYSTEM_JOB_OWNER = "system";

/**
 * Starts the backfill at boot unless it already ran here. A zone lookup that
 * failed its self-check does not start it at all: every place would read as
 * "no zone", and hundreds of questions would be asked about a broken server.
 */
export async function startTimeModelBackfillAtBoot(): Promise<JobView | null> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { timeModelBackfillAt: true },
  });
  if (settings?.timeModelBackfillAt) {
    logger.info({
      operation: "time_model_backfill_skipped",
      message: "Time-model backfill already ran on this instance",
      context: { at: settings.timeModelBackfillAt.toISOString() },
    });
    return null;
  }
  const selfCheck = zoneSelfCheckResult();
  if (!selfCheck?.ok) {
    setBackfillRunState({ state: "failed", code: "TIMEZONE_LOOKUP_UNAVAILABLE" });
    logger.error({
      operation: "time_model_backfill_not_started",
      message: "Time-model backfill not started: the zone lookup failed its self-check",
      context: { reason: selfCheck && !selfCheck.ok ? selfCheck.reason : "self-check not run" },
    });
    return null;
  }
  if (findRunningJob(["timeModel.backfill"])) return null;
  // `startJob` defers the work one tick, so this state is set before it ends.
  const job = startJob("timeModel.backfill", SYSTEM_JOB_OWNER, async () => {
    try {
      const summary = await runTimeModelBackfill();
      setBackfillRunState({ state: "idle" });
      return summary;
    } catch (error) {
      setBackfillRunState({ state: "failed", code: jobErrorOf(error).code });
      throw error;
    }
  });
  setBackfillRunState({ state: "running", jobId: job.id });
  return job;
}

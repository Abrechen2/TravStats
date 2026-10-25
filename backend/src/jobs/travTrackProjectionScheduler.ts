/**
 * TravTrack projections (TravTrack plan E6): every 15 minutes, each account
 * on provider `travtrack` with dirty days — or with points the current country reducer has not seen —
 * gets its country days projected (`services/travtrack/countryProjection.ts`),
 * then its country questions asked (`services/locationEvidence/
 * countrySuggestions.ts`). Bounded per account by the projection's day budget
 * and the questions' cap (review focus 19).
 *
 * Only while the instance's TravTrack is on; switched off, nothing runs and the
 * dirty days wait. Accounts one after another, and a run never overlaps the
 * previous one. A tick takes at most `ACCOUNTS_PER_TICK` accounts and
 * `DAYS_PER_TICK` days; the next continues with the least recently run. No run at boot: the first slot comes within 15 minutes.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { prisma } from "../db";
import { COUNTRY_DAY_REDUCER_VERSION } from "../services/dawarich/countryDaySweep";
import { getCountryResolver } from "../services/geo/countryFromCoordinates";
import { countrySuggestions } from "../services/locationEvidence/countrySuggestions";
import { travTrackInstanceOn } from "../services/travtrack/availability";
import {
  PROJECTION_DAYS_PER_RUN,
  projectTravTrackCountryDays,
} from "../services/travtrack/countryProjection";
import { COUNTRY_DAYS_BIT } from "../services/travtrack/dirtyDays";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "*/15 * * * *";

let schedulerTask: ScheduledTask | null = null;
let running = false;

export type ProjectionRunOptions = {
  /** Injected by tests so the boundary file is not needed. */
  countryAt?: (lat: number, lon: number) => string | null;
  /** The run's clock (backoff); now unless a test moves it. */
  now?: Date;
  /** The question step; `countrySuggestions` unless a test makes it fail. */
  suggest?: typeof countrySuggestions;
  /** Accounts one tick takes at most. */
  maxAccounts?: number;
  /** Days one tick projects at most, over all its accounts. */
  maxDays?: number;
};

/**
 * One tick's budget. The rest waits for the next tick: accounts are taken
 * least recently run first (`last_run_at`), so every account comes round.
 */
export const ACCOUNTS_PER_TICK = 25;
export const DAYS_PER_TICK = 200;

/** The first retry waits one tick, each further failure twice as long, at most a day. */
const BACKOFF_BASE_MS = 15 * 60_000;
const BACKOFF_MAX_MS = 24 * 60 * 60_000;

export const backoffMs = (failures: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));

export type ProjectionRunResult = {
  accounts: number;
  failed: number;
  questions: number;
  /** Days projected or re-run, over all accounts. */
  days: number;
};

/**
 * The accounts with projection work: TravTrack is their provider (owner rule,
 * 2026-10-25 — an account that switched away is never recomputed), and they
 * hold a dirty day, points the current country reducer has not seen, or
 * country questions still owed — and are not inside a failure's backoff.
 */
async function accountsWithWork(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM users u
      JOIN user_settings us ON us.user_id = u.id AND us.location_provider = 'travtrack'
      LEFT JOIN travtrack_derivation_state s ON s.user_id = u.id
     WHERE (s.retry_after IS NULL OR s.retry_after <= ${now})
       AND (EXISTS (
              SELECT 1 FROM travtrack_dirty_days d
               WHERE d.user_id = u.id AND (d.done & ${COUNTRY_DAYS_BIT}) = 0)
            OR COALESCE(s.country_questions_due, false)
            OR (COALESCE(s.country_reducer_version, 0) < ${COUNTRY_DAY_REDUCER_VERSION}
                AND EXISTS (SELECT 1 FROM travtrack_points p WHERE p.user_id = u.id)))
     ORDER BY s.last_run_at ASC NULLS FIRST, u.id
     LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

async function recordFailure(userId: string, now: Date): Promise<void> {
  const row = await prisma.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, failureCount: 1 },
    update: { failureCount: { increment: 1 } },
    select: { failureCount: true },
  });
  await prisma.travTrackDerivationState.update({
    where: { userId },
    data: { retryAfter: new Date(now.getTime() + backoffMs(row.failureCount)) },
  });
}

/** One account: project, then ask what is owed. Throws nothing; answers whether it failed. */
async function runAccount(
  userId: string,
  countryAt: (lat: number, lon: number) => string | null,
  options: ProjectionRunOptions,
  now: Date,
  maxDays: number
): Promise<{ failed: boolean; questions: number; days: number }> {
  try {
    const projected = await projectTravTrackCountryDays(userId, { countryAt, maxDays });
    const days = projected.projected + projected.rerun;
    if (projected.status === "failed") {
      await recordFailure(userId, now);
      return { failed: true, questions: 0, days };
    }
    // Disabled or switched away: nothing ran, nothing failed.
    if (projected.status !== "done") return { failed: false, questions: 0, days };
    if (projected.projected > 0) {
      await prisma.travTrackDerivationState.update({
        where: { userId },
        data: { countryQuestionsDue: true },
      });
    }
    const state = await prisma.travTrackDerivationState.findUnique({
      where: { userId },
      select: { countryQuestionsDue: true },
    });
    let questions = 0;
    if (state?.countryQuestionsDue) {
      const asked = await (options.suggest ?? countrySuggestions)(userId);
      questions = asked.created;
      // Owed until a run finishes with nothing deferred; a stale run asks again.
      const owed = asked.status === "stale" || asked.deferred > 0;
      if (!owed) {
        await prisma.travTrackDerivationState.update({
          where: { userId },
          data: { countryQuestionsDue: false },
        });
      }
    }
    await prisma.travTrackDerivationState.update({
      where: { userId },
      data: { failureCount: 0, retryAfter: null },
    });
    return { failed: false, questions, days };
  } catch (error) {
    logger.warn({
      operation: "travtrack_projections_account_failed",
      userId,
      // The name only: a message could carry a query's values.
      errorName: error instanceof Error ? error.name : "unknown",
    });
    await recordFailure(userId, now).catch(() => undefined);
    return { failed: true, questions: 0, days: 0 };
  }
}

export async function runTravTrackProjections(
  options: ProjectionRunOptions = {}
): Promise<ProjectionRunResult> {
  const result: ProjectionRunResult = { accounts: 0, failed: 0, questions: 0, days: 0 };
  if (!(await travTrackInstanceOn())) return result;
  const now = options.now ?? new Date();
  const accounts = await accountsWithWork(now, options.maxAccounts ?? ACCOUNTS_PER_TICK);
  if (accounts.length === 0) return result;
  // Loaded once per run: the boundary index is several megabytes.
  const countryAt = options.countryAt ?? (await getCountryResolver()).countryAt;
  const dayBudget = options.maxDays ?? DAYS_PER_TICK;
  for (const userId of accounts) {
    const left = Math.min(PROJECTION_DAYS_PER_RUN, dayBudget - result.days);
    if (left <= 0) break;
    result.accounts += 1;
    // One account's failure is one account's: the next is still projected.
    const outcome = await runAccount(userId, countryAt, options, now, left);
    if (outcome.failed) result.failed += 1;
    result.questions += outcome.questions;
    result.days += outcome.days;
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

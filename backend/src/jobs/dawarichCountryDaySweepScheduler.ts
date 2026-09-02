/**
 * Dawarich Country-Day Sweep Scheduler
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.4.
 * The per-account walk lives in `services/dawarich/countryDaySweep.ts`; this
 * file decides WHO is walked, WHEN, and that one account's bad night is only
 * one account's bad night.
 *
 * ## The slot, and its neighbours
 *
 * 04:40 UTC. Both containers run `TZ=UTC`, so a cron expression here means what
 * it says.
 *
 * | Time (UTC) | Job |
 * |---|---|
 * | 02:00 | historical enrichment; the daily/weekly/monthly backup |
 * | 03:00 | airline logo refresh sweep |
 * | 03:00–03:59 | usage-stats ping (jittered across the hour) |
 * | 03:20 | place address backfill |
 * | 04:10 | data-quality sweep |
 * | every :00 | hourly status sweep |
 * | **04:40** | **this** |
 *
 * Unlike the data-quality sweep at 04:10, the ordering here is only about
 * contention — nothing this job reads is written by any of the others, and
 * nothing it writes is read by them tonight. What it competes for is the
 * outbound path: the logo sweep at 03:00 and the address backfill at 03:20 both
 * make external requests, and this one makes a request per account per month to
 * a server that is usually a small box on the user's own LAN. Half past four
 * leaves all three of them alone, sits after the heaviest database pass of the
 * night rather than beside it, and :40 keeps it off the top-of-hour status
 * sweep.
 *
 * There is deliberately **no run at boot**, unlike the place-address backfill.
 * That job fills columns a user is about to look at; this one pulls from
 * somebody else's server, and a restart loop would turn into a request loop
 * against a machine TravStats does not own.
 *
 * ## An account without a Dawarich connection costs nothing
 *
 * Most instances have none, so eligibility is one indexed query over
 * `user_settings` and an account with no connection is never enumerated — no
 * resolver call, no decrypt, no request, no row. See
 * `buildUserDawarichConnection` for why only the USER tier counts here and an
 * admin-global or ENV connection deliberately does not.
 */

import cron from "node-cron";

import { prisma } from "../db";
import { buildKnownAirportTest } from "../services/countryDays/knownAirports";
import { getCountryResolver } from "../services/geo/countryFromCoordinates";
import { createDawarichClient, type DawarichClient } from "../services/dawarich/dawarichClient";
import { buildUserDawarichConnection } from "../services/dawarich/dawarichResolver";
import { sweepUserCountryDays } from "../services/dawarich/countryDaySweep";
import type { DawarichConnection } from "../services/dawarich/errors";
import logger from "../utils/logger";

/** 04:40 UTC — see the table above. */
const CRON_EXPRESSION = "40 4 * * *";

let schedulerTask: cron.ScheduledTask | null = null;

export interface CountryDaySweepOptions {
  /** Sweep one account instead of every eligible one. */
  userId?: string;
  /** Re-walk each account's whole history, ignoring the stored cursors. */
  force?: boolean;
  now?: Date;
  /** Injected by tests so no request ever leaves the process. */
  createClient?: (connection: DawarichConnection) => DawarichClient;
  /** Injected by tests so the boundary file is not needed. */
  countryAt?: (lat: number, lon: number) => string | null;
  /**
   * Injected by tests so no flight table is needed. In production it is built
   * PER ACCOUNT below, because it is a statement about that account's flights.
   */
  atKnownAirport?: (lat: number, lon: number) => boolean;
  maxMonthsWithData?: number;
  maxWindows?: number;
}

export interface CountryDaySweepResult {
  /** Accounts with their own Dawarich connection. */
  users: number;
  /** Accounts whose walk threw something that was not a Dawarich failure. */
  failed: number;
  /** Accounts whose Dawarich did not answer. Their cursors did not move. */
  degraded: number;
  monthsSwept: number;
  windowsRequested: number;
  daysWritten: number;
  partialDays: number;
}

interface EligibleAccount {
  userId: string;
  connection: DawarichConnection;
}

/**
 * Every account that pasted in its OWN Dawarich base URL and key.
 *
 * A row whose key will not decrypt, or whose URL no longer parses, drops out
 * here rather than failing the night: `buildUserDawarichConnection` has already
 * logged which tier was unusable, and an unusable connection is indistinguish-
 * able from an absent one as far as tonight's work is concerned.
 *
 * Sorted so two nights' logs line up and a test can assert an order.
 */
async function eligibleAccounts(userId?: string): Promise<EligibleAccount[]> {
  const rows = await prisma.userSettings.findMany({
    where: {
      ...(userId ? { userId } : {}),
      dawarichBaseUrl: { not: null },
      dawarichApiKey: { not: null },
    },
    select: { userId: true, dawarichBaseUrl: true, dawarichApiKey: true },
    orderBy: { userId: "asc" },
  });

  const accounts: EligibleAccount[] = [];
  for (const row of rows) {
    const connection = buildUserDawarichConnection(row.dawarichBaseUrl, row.dawarichApiKey);
    if (connection) accounts.push({ userId: row.userId, connection });
  }
  return accounts;
}

/**
 * One pass over every eligible account.
 *
 * Accounts are handled one after another, and that sequencing IS the
 * concurrency limit — the same trade `runDataQualitySweep` makes. Fanning out
 * would multiply both the Prisma pool pressure and the number of simultaneous
 * requests aimed at what is often one small self-hosted box.
 *
 * Two failure modes, kept apart because they mean different things to an
 * operator: a Dawarich that did not answer is `degraded` (expected, transient,
 * the account keeps everything it had), while anything else — a database error,
 * a bug — is `failed` and is worth looking at.
 */
export async function runDawarichCountryDaySweep(
  options: CountryDaySweepOptions = {},
): Promise<CountryDaySweepResult> {
  const accounts = await eligibleAccounts(options.userId);

  const result: CountryDaySweepResult = {
    users: accounts.length,
    failed: 0,
    degraded: 0,
    monthsSwept: 0,
    windowsRequested: 0,
    daysWritten: 0,
    partialDays: 0,
  };

  // Nothing to do, and in particular nothing to load: the boundary index is
  // several megabytes and an instance where nobody uses Dawarich must not pay
  // for it every night.
  if (accounts.length === 0) return result;

  const countryAt = options.countryAt ?? (await getCountryResolver()).countryAt;
  const createClient = options.createClient ?? createDawarichClient;
  const now = options.now ?? new Date();

  for (const account of accounts) {
    try {
      /**
       * The §8.2 signal, rebuilt for each account and never shared between
       * them: "an airport somebody flew through" is true of one traveller and
       * false of the next, and a cache across accounts would let one person's
       * itinerary explain another person's days away.
       *
       * Read fresh each night rather than cached across runs, so a flight
       * added today is taken into account tonight.
       */
      const atKnownAirport =
        options.atKnownAirport ?? (await buildKnownAirportTest(account.userId));

      const outcome = await sweepUserCountryDays(account.userId, {
        client: createClient(account.connection),
        countryAt,
        atKnownAirport,
        now,
        force: options.force,
        maxMonthsWithData: options.maxMonthsWithData,
        maxWindows: options.maxWindows,
      });

      result.monthsSwept += outcome.monthsSwept;
      result.windowsRequested += outcome.windowsRequested;
      result.daysWritten += outcome.daysWritten;
      result.partialDays += outcome.partialDays;
      if (outcome.errorKind) result.degraded += 1;
    } catch (error) {
      result.failed += 1;
      logger.warn(
        {
          operation: "dawarich_country_day_sweep_user_failed",
          userId: account.userId,
          message: error instanceof Error ? error.message : String(error),
        },
        "The country-day sweep failed for one account — the sweep continues",
      );
    }
  }

  logger.info(
    { operation: "dawarich_country_day_sweep_done", ...result },
    "Dawarich country-day sweep complete",
  );
  return result;
}

export function startDawarichCountryDaySweepScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDawarichCountryDaySweep();
    } catch (error) {
      // `runDawarichCountryDaySweep` already survives a single account; reaching
      // here means the eligibility query or the boundary load failed, neither of
      // which tonight's run can do anything about.
      logger.warn(
        { operation: "dawarich_country_day_sweep_error", error },
        "Nightly Dawarich country-day sweep failed",
      );
    }
  });
  logger.info(
    { operation: "dawarich_country_day_sweep_scheduler_started", cron: CRON_EXPRESSION },
    "dawarich country-day sweep scheduler started",
  );
}

export function stopDawarichCountryDaySweepScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}

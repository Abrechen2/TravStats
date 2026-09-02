/**
 * Walk one account's Dawarich history month by month and leave country-days
 * behind.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.4.
 * *"A full-history sweep is not a request-time operation — the client already
 * reports `truncated` when a window exceeds `MAX_PAGES × PAGE_SIZE`. A
 * background job sweeps month by month and stores `(userId, date, countryCode,
 * source)`. After that the count is a cheap table read and catching up costs
 * one window."*
 *
 * ## The two halves of a run
 *
 * **Forward**, always: every month from the last completed sweep through the
 * current one. Usually that is one month, which is the "catching up costs one
 * window" the design asks for. The current month is re-read every night on
 * purpose — it is the only month that is still growing.
 *
 * **Backward**, until it is done: one month at a time, older and older, until
 * the floor. Bounded per run so a fresh account with a decade of history does
 * not spend one night hammering the user's own server, and so a Dawarich
 * instance that is slow costs a bounded amount of patience rather than an
 * unbounded one.
 *
 * The backward budget counts **months that held data**, not months. An empty
 * month costs one request and no work, so a history with a two-year gap in the
 * middle walks straight through it instead of concluding the history has ended
 * — a heuristic that stopped on consecutive empty months would silently lose
 * everything older than the gap, permanently, and nothing would ever say so.
 * The hard `MAX_WINDOWS_PER_RUN` keeps the run bounded anyway.
 *
 * ## Truncation is not allowed to become a lie
 *
 * `dawarichClient.ts`'s header states the rule and this is the caller it was
 * written for: *"Callers MUST propagate this rather than only logging it."* A
 * truncated window here is answered by SUBDIVIDING it — halved at a UTC day
 * boundary, again and again, until either a piece comes back whole or the piece
 * is a single day. Points from a truncated window are discarded rather than
 * accumulated, because the sub-windows are about to read them all again and
 * counting them twice would inflate `pointCount`.
 *
 * A single day that still truncates means more than 50,000 fixes in 24 hours
 * (measured on the owner's instance: 1,243). It is not expected, and when it
 * happens the day is stored with `partialWindow: true` and pinned on the sweep
 * state, rather than stored as if it were whole.
 *
 * ## Nothing here throws for a Dawarich problem
 *
 * A server that is down, slow, on another version, or holding a key that has
 * been revoked degrades to an outcome carrying `errorKind` and stops that
 * account's walk with its cursors untouched. Tomorrow's run resumes exactly
 * where this one stood.
 *
 * ## Nothing here logs a coordinate
 *
 * Positions live inside `services/countryDays/reduce.ts` for the length of one
 * loop and are never returned, stored or logged. Every log line below carries
 * counts and a month, and the error path carries a `DawarichErrorKind` rather
 * than a message, because a Dawarich message can contain the base URL and a
 * base URL is the address of somebody's home.
 */

import { prisma } from "../../db";
import logger from "../../utils/logger";
import type { CountryDaySource } from "../countryDays/countryDaySource";
import {
  accumulateCountryDays,
  createCountryDayAccumulator,
  drainCountryDays,
  utcDay,
  type KnownAirportTest,
} from "../countryDays/reduce";
import { replaceCountryDays } from "../countryDays/store";
import type { DawarichClient } from "./dawarichClient";
import { DawarichError, type DawarichErrorKind } from "./errors";

const SOURCE: CountryDaySource = "dawarich";

const DAY_MS = 86_400_000;

/**
 * How far back the backward walk may go: twenty years.
 *
 * Something has to bound it, or a misconfigured server answers "no points" for
 * ever and the walk never finishes. Twenty years is far past any location
 * history that exists — Dawarich's own oldest imports are Google Takeout, which
 * began in 2009 — and short enough that a fully empty walk completes in four
 * nights at the window budget below.
 */
const MAX_HISTORY_MONTHS = 240;

/** Months that actually held points, per run. */
const MAX_MONTHS_WITH_DATA_PER_RUN = 12;

/**
 * Hard ceiling on requests per account per run, subdivision included.
 *
 * The two budgets answer different failures: the one above stops a night from
 * doing a year of real work, this one stops an empty or pathological history
 * from doing an unbounded number of requests to reach the same conclusion.
 */
const MAX_WINDOWS_PER_RUN = 60;

export interface CountryDaySweepDeps {
  /** Already built for THIS user — see `buildUserDawarichConnection`. */
  client: DawarichClient;
  /** `services/geo/countryFromCoordinates.ts`, loaded once by the caller. */
  countryAt: (lat: number, lon: number) => string | null;
  /**
   * "Is this position on the grounds of an airport this account flew through?"
   * — `services/countryDays/knownAirports.ts`, built once per account by the
   * caller because it reads that account's flights.
   *
   * Optional: omitted, every point answers no, which reports "nothing was
   * airside" and lifts a country onto a stronger rung than a connection. The
   * safe direction, and the one an account with no flights genuinely deserves.
   */
  atKnownAirport?: KnownAirportTest;
  now: Date;
  /** Re-walk the whole history from scratch, ignoring the stored cursors. */
  force?: boolean;
  maxMonthsWithData?: number;
  maxWindows?: number;
}

export interface UserSweepOutcome {
  userId: string;
  /** Months read, forward and backward together. */
  monthsSwept: number;
  /** Requests made, subdivision included. */
  windowsRequested: number;
  /** Country-day rows the run left behind in the months it touched. */
  daysWritten: number;
  /** Rows stored from a window that stayed truncated at the one-day floor. */
  partialDays: number;
  backfillComplete: boolean;
  /**
   * Why the walk stopped early, or null. A value here means the cursors were
   * NOT advanced past the failure — nothing is recorded as swept that was not.
   */
  errorKind: DawarichErrorKind | null;
}

function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function startOfUtcMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

function addUtcMonths(monthStart: Date, months: number): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + months, 1));
}

/** `YYYY-MM`, for a log line that says which month without saying where. */
function monthLabel(monthStart: Date): string {
  return monthStart.toISOString().slice(0, 7);
}

/** Every UTC day a half-open window touches. */
function daysCovered(startAt: Date, endAtExclusive: Date): string[] {
  const days: string[] = [];
  for (
    let cursor = startOfUtcDay(startAt).getTime();
    cursor < endAtExclusive.getTime();
    cursor += DAY_MS
  ) {
    days.push(utcDay(cursor));
  }
  return days;
}

interface WindowRun {
  windows: number;
  partialDays: Set<string>;
}

/**
 * Read `[startAt, endAtExclusive)` into the accumulator, subdividing on
 * truncation.
 *
 * The client's window is inclusive on both ends, so the last millisecond is
 * shaved off rather than passing `endAtExclusive` — otherwise a point at
 * exactly midnight would be read by two adjacent windows and counted twice.
 */
async function pullWindow(
  deps: CountryDaySweepDeps,
  accumulator: ReturnType<typeof createCountryDayAccumulator>,
  run: WindowRun,
  startAt: Date,
  endAtExclusive: Date,
): Promise<void> {
  run.windows += 1;
  const { points, truncated } = await deps.client.getPoints({
    startAt,
    endAt: new Date(endAtExclusive.getTime() - 1),
  });

  if (!truncated) {
    accumulateCountryDays(accumulator, points, deps.countryAt, deps.atKnownAirport);
    return;
  }

  const spanMs = endAtExclusive.getTime() - startAt.getTime();
  if (spanMs <= DAY_MS) {
    // The floor. Keep the newest slice Dawarich handed back — those points are
    // real observations — and record that this day's silence proves nothing.
    accumulateCountryDays(accumulator, points, deps.countryAt, deps.atKnownAirport);
    for (const day of daysCovered(startAt, endAtExclusive)) run.partialDays.add(day);
    return;
  }

  // Split at a UTC day boundary so every window below stays day-aligned and the
  // floor is exactly one day rather than some fraction of two.
  const rawMid = startOfUtcDay(new Date(startAt.getTime() + Math.floor(spanMs / 2)));
  const mid = new Date(
    Math.min(
      Math.max(rawMid.getTime(), startAt.getTime() + DAY_MS),
      endAtExclusive.getTime() - DAY_MS,
    ),
  );

  await pullWindow(deps, accumulator, run, startAt, mid);
  await pullWindow(deps, accumulator, run, mid, endAtExclusive);
}

interface MonthResult {
  windows: number;
  written: number;
  partialDays: number;
  hadData: boolean;
}

/** Read one month and make the stored rows for it match what was read. */
async function sweepMonth(
  deps: CountryDaySweepDeps,
  userId: string,
  monthStart: Date,
): Promise<MonthResult> {
  const monthEndExclusive = addUtcMonths(monthStart, 1);
  const accumulator = createCountryDayAccumulator();
  const run: WindowRun = { windows: 0, partialDays: new Set() };

  await pullWindow(deps, accumulator, run, monthStart, monthEndExclusive);

  const observations = drainCountryDays(accumulator);
  const { written } = await replaceCountryDays(
    userId,
    SOURCE,
    { startAt: monthStart, endAtExclusive: monthEndExclusive },
    observations,
    run.partialDays,
  );

  if (run.partialDays.size > 0) {
    logger.warn(
      {
        operation: "dawarich_country_day_window_truncated",
        userId,
        month: monthLabel(monthStart),
        partialDays: run.partialDays.size,
      },
      "A single-day Dawarich window was still truncated — those days are stored as partial",
    );
  }

  return {
    windows: run.windows,
    written,
    partialDays: run.partialDays.size,
    hadData: observations.length > 0,
  };
}

interface SweepCursors {
  backfilledFromMonth: Date | null;
  backfillComplete: boolean;
  sweptThroughAt: Date | null;
}

async function persistCursors(
  userId: string,
  cursors: SweepCursors,
  extra: { lastRunAt?: Date; lastErrorKind?: string | null; lastTruncatedAt?: Date },
): Promise<void> {
  const data = { ...cursors, ...extra };
  await prisma.dawarichSweepState.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

/**
 * One account's walk.
 *
 * Cursors are persisted after every month rather than once at the end: a run
 * interrupted by a restart at month nine has done nine months of real work, and
 * throwing that away would mean a large history could never finish on an
 * instance that reboots nightly.
 */
export async function sweepUserCountryDays(
  userId: string,
  deps: CountryDaySweepDeps,
): Promise<UserSweepOutcome> {
  const stored = await prisma.dawarichSweepState.findUnique({ where: { userId } });

  const cursors: SweepCursors = deps.force
    ? { backfilledFromMonth: null, backfillComplete: false, sweptThroughAt: null }
    : {
        backfilledFromMonth: stored?.backfilledFromMonth ?? null,
        backfillComplete: stored?.backfillComplete ?? false,
        sweptThroughAt: stored?.sweptThroughAt ?? null,
      };

  const maxMonthsWithData = deps.maxMonthsWithData ?? MAX_MONTHS_WITH_DATA_PER_RUN;
  const maxWindows = deps.maxWindows ?? MAX_WINDOWS_PER_RUN;

  const outcome: UserSweepOutcome = {
    userId,
    monthsSwept: 0,
    windowsRequested: 0,
    daysWritten: 0,
    partialDays: 0,
    backfillComplete: cursors.backfillComplete,
    errorKind: null,
  };

  const currentMonth = startOfUtcMonth(deps.now);
  const floorMonth = addUtcMonths(currentMonth, -MAX_HISTORY_MONTHS);
  let monthsWithData = 0;
  let lastTruncatedAt: Date | undefined;

  const applyMonth = (monthStart: Date, month: MonthResult): void => {
    outcome.monthsSwept += 1;
    outcome.windowsRequested += month.windows;
    outcome.daysWritten += month.written;
    outcome.partialDays += month.partialDays;
    if (month.partialDays > 0) lastTruncatedAt = monthStart;
    if (month.hadData) monthsWithData += 1;
  };

  try {
    // ---- Forward: everything since the last completed sweep, ending with the
    // month that is still growing.
    const firstForwardMonth = startOfUtcMonth(cursors.sweptThroughAt ?? deps.now);
    for (
      let month = firstForwardMonth;
      month.getTime() <= currentMonth.getTime();
      month = addUtcMonths(month, 1)
    ) {
      applyMonth(month, await sweepMonth(deps, userId, month));
    }
    cursors.sweptThroughAt = deps.now;
    if (
      cursors.backfilledFromMonth === null ||
      firstForwardMonth.getTime() < cursors.backfilledFromMonth.getTime()
    ) {
      cursors.backfilledFromMonth = firstForwardMonth;
    }
    await persistCursors(userId, cursors, {});

    // ---- Backward: older and older, within the run's budget.
    while (
      !cursors.backfillComplete &&
      monthsWithData < maxMonthsWithData &&
      outcome.windowsRequested < maxWindows
    ) {
      const candidate = addUtcMonths(cursors.backfilledFromMonth ?? currentMonth, -1);
      if (candidate.getTime() < floorMonth.getTime()) {
        cursors.backfillComplete = true;
        break;
      }
      applyMonth(candidate, await sweepMonth(deps, userId, candidate));
      cursors.backfilledFromMonth = candidate;
      await persistCursors(userId, cursors, {});
    }

    outcome.backfillComplete = cursors.backfillComplete;
    await persistCursors(userId, cursors, {
      lastRunAt: deps.now,
      lastErrorKind: null,
      ...(lastTruncatedAt ? { lastTruncatedAt } : {}),
    });
  } catch (error) {
    // A Dawarich problem is an outcome, not an exception: the account keeps the
    // country-days it already had, the cursors stay where the last complete
    // month left them, and tomorrow's run resumes from there.
    if (!(error instanceof DawarichError)) throw error;

    outcome.errorKind = error.kind;
    outcome.backfillComplete = cursors.backfillComplete;
    await persistCursors(userId, cursors, {
      lastRunAt: deps.now,
      lastErrorKind: error.kind,
      ...(lastTruncatedAt ? { lastTruncatedAt } : {}),
    });
    logger.warn(
      {
        operation: "dawarich_country_day_sweep_degraded",
        userId,
        kind: error.kind,
        monthsSwept: outcome.monthsSwept,
      },
      "Dawarich did not answer — this account's sweep stopped where it stood",
    );
  }

  return outcome;
}

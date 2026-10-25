/**
 * TravTrack's country days (TravTrack plan E6; review focus 24): the `travtrack`
 * rows of `country_days`, which the passport reads as unconfirmed track
 * countries beside Dawarich's (forgejo#299 — observations never enter the
 * evidence fold). The Dawarich sweep is another source and never touched.
 *
 * Per run up to `PROJECTION_DAYS_PER_RUN` dirty days, oldest first, ONE DAY PER
 * TRANSACTION under the account's TravTrack lock — no ingest or removal can
 * interleave with it:
 *   1. the dirty row's `version` is read;
 *   2. the day `[00:00Z, next 00:00Z)` is read through the derivation read
 *      (E2: every page, anomalies masked, in-flight points marked);
 *   3. in-flight and masked points are dropped, the rest reduced exactly as
 *      the Dawarich sweep reduces its points (`accumulateCountryDays`);
 *   4. the day's `travtrack` rows are replaced (`replaceCountryDays` in this
 *      transaction) — a day read `truncated` is written `partialWindow`;
 *   5. the day is acknowledged only if its `version` is still the one read.
 *      A day marked again meanwhile runs again.
 * A failure rolls the day back whole: the old rows and the dirty mark stay.
 *
 * Only while the instance's TravTrack is on. Switched off, nothing runs and the
 * dirty days wait; removals still delete their days' rows (`projectionRemoval`).
 * Failure kinds go to `travtrack_derivation_state.last_error_kind` from a closed
 * vocabulary — never a message, never a position.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import {
  accumulateCountryDays,
  createCountryDayAccumulator,
  drainCountryDays,
  type InFlightTest,
  type KnownAirportTest,
} from "../countryDays/reduce";
import { replaceCountryDays, utcMidnight } from "../countryDays/store";
import { buildFlightAirTimeTest } from "../countryDays/flightAirTime";
import { buildKnownAirportTest } from "../countryDays/knownAirports";
import { COUNTRY_DAY_REDUCER_VERSION } from "../dawarich/countryDaySweep";
import { getCountryResolver } from "../geo/countryFromCoordinates";
import { readTravTrackDerivation } from "../locationEvidence/derivationRead";
import { historyGeneration } from "../locationEvidence/generation";
import { toTimedPosition } from "../locationEvidence/toDetectorInput";
import { travTrackInstanceOn } from "./availability";
import {
  ackDirtyDay,
  COUNTRY_DAYS_BIT,
  markAllPointDaysDirty,
  pendingDirtyDays,
  type DirtyDay,
} from "./dirtyDays";
import { takeTravTrackLock } from "./lock";

/** Dirty days one run projects at most. */
export const PROJECTION_DAYS_PER_RUN = 62;

const DAY_MS = 86_400_000;

/** `travtrack_derivation_state.last_error_kind` (CHECK). */
export type ProjectionErrorKind = "disabled" | "database" | "reducer";

export type CountryProjectionDeps = {
  /** `services/geo/countryFromCoordinates.ts` unless a test injects one. */
  countryAt?: (lat: number, lon: number) => string | null;
  /** Built from the account's flights unless injected. */
  atKnownAirport?: KnownAirportTest;
  /** Built from the account's flights unless injected. */
  inFlight?: InFlightTest;
  maxDays?: number;
  /** The derivation read's cap; its default unless a test needs a small one. */
  maxPoints?: number;
  /** Test seam: runs inside the day's transaction, after the replace, before the ack. */
  beforeAck?: (day: string) => Promise<void>;
};

export type CountryProjectionResult = {
  status: "done" | "disabled" | "failed";
  /** Days replaced and acknowledged. */
  projected: number;
  /** Days marked again while they were projected; they run again. */
  rerun: number;
  errorKind: ProjectionErrorKind | null;
};

/** A failure of the reduction itself, kept apart from the database's. */
class ReducerFailure extends Error {}

/** The generation moved under the lock — impossible while removals take it; never published. */
class StaleRead extends Error {}

async function recordState(userId: string, errorKind: ProjectionErrorKind | null): Promise<void> {
  await prisma.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, lastRunAt: new Date(), lastErrorKind: errorKind },
    update: { lastRunAt: new Date(), lastErrorKind: errorKind },
  });
}

/** A raised reducer version re-marks every day holding TravTrack points, once. */
async function remarkOnReducerChange(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    const state = await tx.travTrackDerivationState.findUnique({
      where: { userId },
      select: { countryReducerVersion: true },
    });
    if ((state?.countryReducerVersion ?? 0) >= COUNTRY_DAY_REDUCER_VERSION) return;
    await markAllPointDaysDirty(tx, userId);
    await tx.travTrackDerivationState.upsert({
      where: { userId },
      create: { userId, countryReducerVersion: COUNTRY_DAY_REDUCER_VERSION },
      update: { countryReducerVersion: COUNTRY_DAY_REDUCER_VERSION },
    });
  });
}

type Resolved = Required<Pick<CountryProjectionDeps, "countryAt" | "atKnownAirport" | "inFlight">>;

async function resolveDeps(userId: string, deps: CountryProjectionDeps): Promise<Resolved> {
  const countryAt = deps.countryAt ?? (await getCountryResolver()).countryAt;
  const [atKnownAirport, inFlight] = await Promise.all([
    deps.atKnownAirport ?? buildKnownAirportTest(userId),
    deps.inFlight ?? buildFlightAirTimeTest(userId, countryAt),
  ]);
  return { countryAt, atKnownAirport, inFlight };
}

/** One day: read, reduce, replace, ack — one transaction. True when acknowledged. */
async function projectDay(
  userId: string,
  dirty: DirtyDay,
  resolved: Resolved,
  deps: CountryProjectionDeps
): Promise<boolean> {
  const startAt = utcMidnight(dirty.day);
  const endAtExclusive = new Date(startAt.getTime() + DAY_MS);
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      // Acknowledged by another run meanwhile: nothing to do.
      const version = await tx.travTrackDirtyDay.findUnique({
        where: { userId_day: { userId, day: startAt } },
        select: { version: true, done: true },
      });
      if (!version || (version.done & COUNTRY_DAYS_BIT) !== 0) return true;
      const read = await readTravTrackDerivation(
        userId,
        { fromMs: startAt.getTime(), untilMs: endAtExclusive.getTime() },
        deps.maxPoints === undefined ? {} : { maxPoints: deps.maxPoints }
      );
      if ((await historyGeneration(tx, userId)) !== read.generation) throw new StaleRead();

      const accumulator = createCountryDayAccumulator();
      try {
        accumulateCountryDays(
          accumulator,
          read.points.filter((p) => !p.inFlight).map(toTimedPosition),
          resolved.countryAt,
          resolved.atKnownAirport,
          resolved.inFlight
        );
      } catch {
        throw new ReducerFailure();
      }
      const partial = read.coverage === "truncated" ? new Set([dirty.day]) : new Set<string>();
      await replaceCountryDays(
        userId,
        "travtrack",
        { startAt, endAtExclusive },
        drainCountryDays(accumulator),
        partial,
        tx
      );
      await deps.beforeAck?.(dirty.day);
      return ackDirtyDay(
        tx,
        userId,
        { day: dirty.day, version: version.version },
        COUNTRY_DAYS_BIT
      );
    },
    { timeout: 120_000 }
  );
}

export async function projectTravTrackCountryDays(
  userId: string,
  deps: CountryProjectionDeps = {}
): Promise<CountryProjectionResult> {
  const result: CountryProjectionResult = {
    status: "done",
    projected: 0,
    rerun: 0,
    errorKind: null,
  };
  if (!(await travTrackInstanceOn())) {
    await recordState(userId, "disabled");
    return { ...result, status: "disabled", errorKind: "disabled" };
  }
  try {
    await remarkOnReducerChange(userId);
    const days = await pendingDirtyDays(
      userId,
      COUNTRY_DAYS_BIT,
      deps.maxDays ?? PROJECTION_DAYS_PER_RUN
    );
    if (days.length > 0) {
      const resolved = await resolveDeps(userId, deps);
      for (const day of days) {
        if (await projectDay(userId, day, resolved, deps)) result.projected += 1;
        else result.rerun += 1;
      }
    }
  } catch (error) {
    const errorKind: ProjectionErrorKind = error instanceof ReducerFailure ? "reducer" : "database";
    // Ids and kinds only: the day's positions never reach a log.
    logger.warn({
      operation: "travtrack.countryProjection.failed",
      userId,
      errorKind,
      stale: error instanceof StaleRead,
    });
    await recordState(userId, errorKind);
    return { ...result, status: "failed", errorKind };
  }
  await recordState(userId, null);
  return result;
}

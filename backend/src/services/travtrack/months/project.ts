/**
 * TravTrack's monthly values (TravTrack plan L3, review focus 27, 28): per UTC
 * month the ground kilometres, the countries and — only when the account
 * switched the lookup on — the cities, recomputed whenever a day of the month
 * is dirty on the projection's own `done` bit (`MONTHS_BIT`).
 *
 * One MONTH per transaction under the account's TravTrack lock: read the
 * month's dirty rows and their versions, read the month whole through the
 * privacy-safe read (`readSafe.ts`, so no figure counts what a zone hides),
 * replace the month's row, and acknowledge each day only for the version
 * read. Ingest and every removal take the same lock, so nothing the read saw
 * changes before the commit; a point stored meanwhile re-marks its day and the
 * month runs again. A month too large to read whole fails rather than writing
 * part of it.
 *
 *   - `countries` come from the month's `travtrack` country days, so a month
 *     waits (unacknowledged) while any of its days still owes the country
 *     projection (`COUNTRY_DAYS_BIT`).
 *   - A month without a single privacy-safe vertex has no row: absent, never
 *     zero (abstention).
 *   - `cities` is null while the lookup is off — and while a dwell's cell has
 *     no cached answer yet: the cells are looked up after the transaction (no
 *     network call holds the lock) and the month runs once more; a lookup that
 *     failed leaves it unacknowledged for the next run.
 *
 * Only while the instance's TravTrack is on and the account's provider is
 * TravTrack (`travTrackDerivationAllowed`). A removal deletes the months of its
 * days in its own transaction (`monthsOnHistoryDeleted`).
 */
import { Prisma } from "../../../prisma";
import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import { getCountryResolver } from "../../geo/countryFromCoordinates";
import {
  travTrackDerivationAllowed,
  type DerivationAllowance,
} from "../../locationEvidence/allowed";
import { flightWindowsIn } from "../../locationEvidence/derivationRead";
import {
  ackDirtyDay,
  COUNTRY_DAYS_BIT,
  MONTHS_BIT,
  removalDays,
  unprojectedDaysIn,
} from "../dirtyDays";
import { takeTravTrackLock } from "../lock";
import { readSafeTravTrack, type SafeCursor } from "../readSafe";
import {
  citiesFromCache,
  dwellCells,
  lookUpCityCells,
  MAX_CITY_LOOKUPS_PER_RUN,
  type CityCell,
  type CityLookupDeps,
} from "./cities";
import { groundKm, inFlightBy, spanDays, vertexDays } from "./values";

/** Raised when the figures' rules change, so a reader can tell an old row from a new one. */
export const MONTHS_ALGORITHM = 1;
/** Months one run recomputes at most. */
export const MONTHS_PER_RUN = 6;
const PAGE = 50_000;
/** Pages one month is read in at most (2.5 M points); beyond, it fails rather than count part. */
const MAX_PAGES_PER_MONTH = 50;

export type MonthsProjectionDeps = {
  maxMonths?: number;
  /** Test seam: runs inside the month's transaction, after the replace, before the acks. */
  beforeAck?: (month: string) => Promise<void>;
  geocode?: CityLookupDeps["geocode"];
  countryAt?: CityLookupDeps["countryAt"];
  /** Points per page of the safe read; `PAGE` unless a test needs small pages. */
  pageSize?: number;
};

export type MonthsProjectionResult = {
  /** `skipped`: the account's provider is not TravTrack; nothing was touched. */
  status: "done" | "disabled" | "skipped" | "failed";
  /** Months written and acknowledged. */
  projected: number;
  /** Months left owed: a day re-marked meanwhile, a country day still owed, a city not looked up. */
  rerun: number;
  /** Days acknowledged over all months. */
  days: number;
  /** Cells sent to the geocoder. */
  lookups: number;
};

class MonthTooLarge extends Error {}

const DAY_MS = 86_400_000;

/** `[first day, first day of the next month)` of the month starting on `month` (`YYYY-MM-01`). */
export function monthWindow(month: string): { fromMs: number; untilMs: number } {
  const from = new Date(`${month}T00:00:00.000Z`);
  const until = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { fromMs: from.getTime(), untilMs: until.getTime() };
}

const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
const dayString = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type MonthFigures = { km: number; days: Set<string>; paused: Set<string>; cells: CityCell[] };

/** The month read whole, page by page, every figure from the privacy-safe stretches. */
async function readMonth(
  userId: string,
  window: { fromMs: number; untilMs: number },
  withCities: boolean,
  pageSize: number
): Promise<MonthFigures> {
  const flights = await flightWindowsIn(userId, window);
  const figures: MonthFigures = { km: 0, days: new Set(), paused: new Set(), cells: [] };
  const cells = new Map<string, CityCell>();
  let cursor: SafeCursor | null = null;
  for (let page = 0; page < MAX_PAGES_PER_MONTH; page++) {
    const read = await readSafeTravTrack(userId, window, pageSize, cursor);
    const inFlight = inFlightBy(flights, (p) => read.rowOf(p)?.purpose === "flight");
    // A page boundary ends each stretch: the one step across it is not
    // counted — an undercount of a step, never a hidden one.
    figures.km += groundKm(read.segments, inFlight);
    for (const day of vertexDays(read.segments)) figures.days.add(day);
    for (const span of read.paused) {
      for (const day of spanDays(span, window)) figures.paused.add(day);
    }
    if (withCities) {
      for (const c of dwellCells(read.segments, read.circles, inFlight)) cells.set(c.cell, c);
    }
    if (!read.next || !read.cursor) {
      figures.cells = [...cells.values()];
      return figures;
    }
    cursor = read.cursor;
  }
  throw new MonthTooLarge();
}

type MonthOutcome = { acked: number; owed: boolean; missing: CityCell[] };

/** One month: read, replace, ack — one transaction. */
async function projectMonth(
  userId: string,
  month: string,
  deps: MonthsProjectionDeps
): Promise<MonthOutcome> {
  const window = monthWindow(month);
  const lastDay = dayString(window.untilMs - DAY_MS);
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const pending = await tx.$queryRaw<{ day: Date; version: bigint }[]>`
        SELECT day, version FROM travtrack_dirty_days
         WHERE user_id = ${userId} AND (done & ${MONTHS_BIT}) = 0
           AND day >= ${month}::date AND day <= ${lastDay}::date`;
      if (pending.length === 0) return { acked: 0, owed: false, missing: [] };
      // The countries are the country projection's: wait until it is done here.
      const countriesOwed = await unprojectedDaysIn(userId, COUNTRY_DAYS_BIT, month, lastDay, tx);
      if (countriesOwed.size > 0) return { acked: 0, owed: true, missing: [] };

      const settings = await tx.userSettings.findUnique({
        where: { userId },
        select: { travtrackCityLookup: true },
      });
      const withCities = settings?.travtrackCityLookup === true;
      const figures = await readMonth(userId, window, withCities, deps.pageSize ?? PAGE);
      const monthDate = new Date(window.fromMs);
      let missing: CityCell[] = [];
      if (figures.days.size === 0) {
        await tx.travTrackMonthValue.deleteMany({ where: { userId, month: monthDate } });
      } else {
        const countryRows = await tx.countryDay.findMany({
          where: {
            userId,
            source: "travtrack",
            date: { gte: monthDate, lt: new Date(window.untilMs) },
          },
          distinct: ["countryCode"],
          select: { countryCode: true },
        });
        let cities: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
        if (withCities) {
          const found = await citiesFromCache(figures.cells, tx);
          missing = found.missing;
          if (missing.length === 0) cities = found.cities as unknown as Prisma.InputJsonValue;
        }
        const values = {
          kmGround: figures.km,
          countries: countryRows.map((r) => r.countryCode).sort(),
          cities,
          daysWithData: figures.days.size,
          daysPaused: figures.paused.size,
          algorithm: MONTHS_ALGORITHM,
          computedAt: new Date(),
        };
        await tx.travTrackMonthValue.upsert({
          where: { userId_month: { userId, month: monthDate } },
          create: { userId, month: monthDate, ...values },
          update: values,
        });
      }
      await deps.beforeAck?.(month);
      // A city still to look up: written without cities, and owed.
      if (missing.length > 0) return { acked: 0, owed: true, missing };
      let acked = 0;
      for (const row of pending) {
        const day = dayString(row.day.getTime());
        if (await ackDirtyDay(tx, userId, { day, version: row.version }, MONTHS_BIT)) acked += 1;
      }
      return { acked, owed: acked < pending.length, missing };
    },
    { timeout: 120_000 }
  );
}

/** The months holding a day still owed on `MONTHS_BIT`, oldest first. */
async function pendingMonths(userId: string, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ month: Date }[]>`
    SELECT DISTINCT date_trunc('month', day)::date AS month FROM travtrack_dirty_days
     WHERE user_id = ${userId} AND (done & ${MONTHS_BIT}) = 0
     ORDER BY month ASC LIMIT ${limit}`;
  return rows.map((r) => dayString(r.month.getTime()));
}

export async function projectMonths(
  userId: string,
  deps: MonthsProjectionDeps = {}
): Promise<MonthsProjectionResult> {
  const result: MonthsProjectionResult = {
    status: "done",
    projected: 0,
    rerun: 0,
    days: 0,
    lookups: 0,
  };
  const stop = (allowance: DerivationAllowance): MonthsProjectionResult => ({
    ...result,
    status:
      allowance === "disabled" ? "disabled" : allowance === "providerOff" ? "skipped" : "done",
  });
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance !== "ok") return stop(allowance);
  try {
    let countryAt = deps.countryAt;
    for (const month of await pendingMonths(userId, deps.maxMonths ?? MONTHS_PER_RUN)) {
      // Asked before every month: a switch stops the run, not the next one.
      const now = await travTrackDerivationAllowed(userId);
      if (now !== "ok") return stop(now);
      let outcome = await projectMonth(userId, month, deps);
      const budget = MAX_CITY_LOOKUPS_PER_RUN - result.lookups;
      if (outcome.missing.length > 0 && budget > 0) {
        countryAt ??= (await getCountryResolver()).countryAt;
        result.lookups += await lookUpCityCells(outcome.missing, {
          geocode: deps.geocode,
          countryAt,
          max: budget,
        });
        outcome = await projectMonth(userId, month, deps);
      }
      result.days += outcome.acked;
      if (outcome.owed) result.rerun += 1;
      else result.projected += 1;
    }
  } catch (error) {
    // Ids and kinds only: the month's positions never reach a log.
    logger.warn({
      operation: "travtrack.monthsProjection.failed",
      userId,
      tooLarge: error instanceof MonthTooLarge,
    });
    return { ...result, status: "failed" };
  }
  return result;
}

/**
 * The removal hook's part (review focus 28): the months of the removed days
 * and of their neighbours go in the removal's transaction.
 * `projectionRemoval.ts` marks the same days dirty, and the next run
 * recomputes the months from what is left.
 */
export async function monthsOnHistoryDeleted(
  tx: DbTransaction,
  userId: string,
  days: readonly string[]
): Promise<void> {
  const months = [...new Set(removalDays(days).map(monthOf))];
  if (months.length === 0) return;
  await tx.travTrackMonthValue.deleteMany({
    where: { userId, month: { in: months.map((m) => new Date(`${m}T00:00:00.000Z`)) } },
  });
}

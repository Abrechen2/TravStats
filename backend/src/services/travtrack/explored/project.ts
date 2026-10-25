/**
 * The explored map's cells (TravTrack plan L1, review focus 28): which zoom-14
 * tiles (`cells.ts`) the account's ground points fell in, per UTC day.
 *
 * E6's dirty-day protocol with its own `done` bit (`EXPLORED_BIT`): per run up
 * to `PROJECTION_DAYS_PER_RUN` days, oldest first, ONE DAY PER TRANSACTION
 * under the account's TravTrack lock — read the dirty row's `version`, read
 * the day `[00:00Z, next 00:00Z)` with each device's edge context through the
 * derivation read (anomalies masked; in-flight points dropped here), replace
 * the day's cells, and acknowledge only if the version is still the one read.
 * A day too large for one read is paged to its end, so the cells are exact.
 * A failure rolls the day back whole: the old cells and the dirty mark stay.
 *
 * Only while the instance's TravTrack is on and the account's provider is
 * TravTrack (`travTrackDerivationAllowed`); otherwise nothing runs and the
 * dirty days wait. A removal deletes the cells of its days in its own
 * transaction (`exploredOnHistoryDeleted`, called from `projectionRemoval.ts`).
 */
import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import { utcMidnight } from "../../countryDays/store";
import {
  travTrackDerivationAllowed,
  type DerivationAllowance,
} from "../../locationEvidence/allowed";
import { readTravTrackDerivation } from "../../locationEvidence/derivationRead";
import { historyGeneration } from "../../locationEvidence/generation";
import { PROJECTION_DAYS_PER_RUN } from "../countryProjection";
import {
  ackDirtyDay,
  contextWindow,
  EXPLORED_BIT,
  pendingDirtyDays,
  removalDays,
  type DirtyDay,
} from "../dirtyDays";
import { takeTravTrackLock } from "../lock";
import { cellKey, cellsOfPoints, type Cell } from "./cells";

const DAY_MS = 86_400_000;
/** Pages one day is read in at most; a day beyond them fails rather than writing part of it. */
const MAX_PAGES_PER_DAY = 40;

export type ExploredProjectionDeps = {
  maxDays?: number;
  /** The derivation read's cap; its default unless a test needs a small one. */
  maxPoints?: number;
  /** Test seam: runs inside the day's transaction, after the replace, before the ack. */
  beforeAck?: (day: string) => Promise<void>;
};

export type ExploredProjectionResult = {
  /** `skipped`: the account's provider is not TravTrack; nothing was touched. */
  status: "done" | "disabled" | "skipped" | "failed";
  projected: number;
  rerun: number;
};

class Cancelled extends Error {}
class StaleRead extends Error {}
class DayTooLarge extends Error {}

/** The day's ground cells: every page of the read, in-flight and masked points left out. */
async function dayCells(
  userId: string,
  tx: DbTransaction,
  startAt: Date,
  endAt: Date,
  deps: ExploredProjectionDeps
): Promise<Cell[]> {
  const window = await contextWindow(userId, startAt, endAt, tx);
  const found = new Map<string, Cell>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_DAY; page++) {
    const read = await readTravTrackDerivation(userId, window, {
      isAllowed: async () => (await travTrackDerivationAllowed(userId)) === "ok",
      ...(deps.maxPoints === undefined ? {} : { maxPoints: deps.maxPoints }),
      ...(cursor ? { cursor } : {}),
    });
    if (read.cancelled) throw new Cancelled();
    if ((await historyGeneration(tx, userId)) !== read.generation) throw new StaleRead();
    const ground = read.points.filter(
      (p) => !p.inFlight && p.atMs >= startAt.getTime() && p.atMs < endAt.getTime()
    );
    for (const c of cellsOfPoints(ground)) found.set(cellKey(c), c);
    if (read.coverage !== "truncated" || !read.next) return [...found.values()];
    cursor = read.next;
  }
  throw new DayTooLarge();
}

/** One day: read, replace, ack — one transaction. True when acknowledged. */
async function projectDay(
  userId: string,
  dirty: DirtyDay,
  deps: ExploredProjectionDeps
): Promise<boolean> {
  const startAt = utcMidnight(dirty.day);
  const endAt = new Date(startAt.getTime() + DAY_MS);
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const row = await tx.travTrackDirtyDay.findUnique({
        where: { userId_day: { userId, day: startAt } },
        select: { version: true, done: true },
      });
      if (!row || (row.done & EXPLORED_BIT) !== 0) return true;
      const cells = await dayCells(userId, tx, startAt, endAt, deps);
      await tx.travTrackExploredCell.deleteMany({ where: { userId, day: startAt } });
      if (cells.length > 0) {
        await tx.travTrackExploredCell.createMany({
          data: cells.map((c) => ({ userId, day: startAt, x: c.x, y: c.y })),
        });
      }
      await deps.beforeAck?.(dirty.day);
      return ackDirtyDay(tx, userId, { day: dirty.day, version: row.version }, EXPLORED_BIT);
    },
    { timeout: 120_000 }
  );
}

export async function projectExploredCells(
  userId: string,
  deps: ExploredProjectionDeps = {}
): Promise<ExploredProjectionResult> {
  const result: ExploredProjectionResult = { status: "done", projected: 0, rerun: 0 };
  const stop = (allowance: DerivationAllowance): ExploredProjectionResult => ({
    ...result,
    status:
      allowance === "disabled" ? "disabled" : allowance === "providerOff" ? "skipped" : "done",
  });
  const allowance = await travTrackDerivationAllowed(userId);
  if (allowance !== "ok") return stop(allowance);
  try {
    const days = await pendingDirtyDays(
      userId,
      EXPLORED_BIT,
      deps.maxDays ?? PROJECTION_DAYS_PER_RUN
    );
    for (const day of days) {
      // Asked before every day: a switch stops the run, not the next one.
      const now = await travTrackDerivationAllowed(userId);
      if (now !== "ok") return stop(now);
      try {
        if (await projectDay(userId, day, deps)) result.projected += 1;
        else result.rerun += 1;
      } catch (error) {
        if (!(error instanceof Cancelled)) throw error;
        return stop(await travTrackDerivationAllowed(userId));
      }
    }
  } catch (error) {
    // Ids and kinds only: the day's positions never reach a log.
    logger.warn({
      operation: "travtrack.exploredProjection.failed",
      userId,
      stale: error instanceof StaleRead,
      tooLarge: error instanceof DayTooLarge,
    });
    return { ...result, status: "failed" };
  }
  return result;
}

/**
 * The removal hook's part (review focus 28): the cells of the removed days and
 * of their neighbours — which read the removed points as edge context — go in
 * the removal's transaction. `projectionRemoval.ts` marks the same days dirty,
 * and the next run rebuilds them from what is left.
 */
export async function exploredOnHistoryDeleted(
  tx: DbTransaction,
  userId: string,
  days: readonly string[]
): Promise<void> {
  const affected = removalDays(days);
  if (affected.length === 0) return;
  await tx.travTrackExploredCell.deleteMany({
    where: { userId, day: { in: affected.map((d) => utcMidnight(d)) } },
  });
}

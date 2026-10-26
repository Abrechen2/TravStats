import { randomUUID } from "node:crypto";

import { prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import { AppError } from "../../../middleware/errorHandler";
import { MAX_HISTORY_MONTHS } from "../../dawarich/countryDaySweep";
import { getDawarichConnection } from "../../dawarich/dawarichResolver";
import { startJob } from "../../jobs/jobRegistry";
import { takeTravTrackLock } from "../lock";
import { activeImports, releaseActiveImport, settleLeftovers } from "./fileImport";
import { DAY_MS, dayKey } from "./dawarichRead";
import { monthsOf, readReport, totalsOf } from "./dawarichReport";
import {
  ownDawarichConnection,
  runDawarichCopy,
  type CopyErrorKind,
  type CopyRunOptions,
  type CopyStatus,
} from "./dawarichRun";

export type { CopyRunOptions } from "./dawarichRun";

/**
 * Copying the account's own Dawarich history into TravTrack (TravTrack plan
 * L6): an explicit action the user starts — nothing starts it on its own, and
 * a provider switch neither starts nor needs it (rule 2: the provider is not
 * touched here). Dawarich is only read (rule 5).
 *
 * The copy's state lives in `travtrack_dawarich_imports` (one row per
 * account), not in the job: `jobRegistry` is in memory, so the job is only the
 * handle for the click. A `running` row this process does not work on and
 * whose heartbeat is stale reads as `interrupted`; resume continues from its
 * checkpoint. Stop pauses between two requests. Deleting the copy is deleting
 * its import (`deleteTravTrackImport`): under the lock it goes `cancelled`,
 * and the next day's fence stores nothing.
 */

/** A `running` row whose heartbeat is older than this, and no run of this process: interrupted. */
export const COPY_STALE_MS = 2 * 60_000;

export type CopyRange = { fromDay?: string; untilDay?: string };

/** A copy that can go on from its checkpoint: a new one waits until it is resumed or deleted. */
const RESUMABLE = new Set(["paused", "interrupted", "failed"]);

const invalid = (message: string) => new AppError(message, 400, "VALIDATION_FAILED");
const running = () => new AppError("An import is running already", 409, "TRAVTRACK_IMPORT_RUNNING");
const notConfigured = () =>
  new AppError(
    "Copying needs this account's own Dawarich connection",
    409,
    "DAWARICH_NOT_CONFIGURED"
  );

function parseDay(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ms) || dayKey(ms) !== day) {
    throw invalid("A day is YYYY-MM-DD");
  }
  return ms;
}

/**
 * The range in UTC days, both inclusive. None given: the whole history the
 * country sweep's backward walk would reach (its twenty-year floor) up to
 * yesterday, so every copied day is a whole one.
 */
export function resolveCopyRange(
  range: CopyRange,
  now = Date.now()
): { fromMs: number; untilMs: number } {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const d = new Date(today);
  const floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - MAX_HISTORY_MONTHS, 1);
  if (range.fromDay === undefined && range.untilDay === undefined) {
    return { fromMs: floor, untilMs: today - DAY_MS };
  }
  if (range.fromDay === undefined || range.untilDay === undefined) {
    throw invalid("A range names both fromDay and untilDay");
  }
  const fromMs = parseDay(range.fromDay);
  const untilMs = parseDay(range.untilDay);
  if (fromMs > untilMs) throw invalid("fromDay is after untilDay");
  if (untilMs > today) throw invalid("untilDay is in the future");
  if (fromMs < floor) throw invalid("fromDay is before the twenty years a copy reaches back");
  return { fromMs, untilMs };
}

/** A `running` copy no process here works on, with a stale heartbeat, becomes interrupted. */
async function settleStale(tx: DbTransaction, userId: string): Promise<void> {
  const row = await tx.travTrackDawarichImport.findUnique({ where: { userId } });
  if (!row || row.status !== "running" || activeImports.has(row.importId)) return;
  if (row.heartbeatAt && Date.now() - row.heartbeatAt.getTime() <= COPY_STALE_MS) return;
  await tx.travTrackDawarichImport.update({
    where: { userId },
    data: { status: "interrupted", runId: null },
  });
  await tx.travTrackImport.updateMany({
    where: { id: row.importId, status: "running" },
    data: { status: "interrupted", finishedAt: new Date() },
  });
}

function launch(userId: string, runId: string, importId: string, opts: CopyRunOptions) {
  const job = startJob("travtrack.dawarichImport", userId, async () => {
    try {
      return await runDawarichCopy(userId, runId, importId, opts);
    } finally {
      releaseActiveImport(importId, runId);
    }
  });
  return { jobId: job.id, importId };
}

/**
 * Runs `claim` under the lock with `importId` marked as worked on by `runId`;
 * a failed claim releases only its own mark, never a live run's.
 */
async function claimed(
  userId: string,
  importId: string,
  runId: string,
  claim: (tx: DbTransaction) => Promise<void>
): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await takeTravTrackLock(tx, userId);
      await settleStale(tx, userId);
      const row = await tx.travTrackDawarichImport.findUnique({
        where: { userId },
        select: { status: true },
      });
      if (row?.status === "running") throw running();
      // Marked before the commit, as a file import does: a second request
      // waiting on the lock must see this one as worked on.
      activeImports.set(importId, runId);
      if (await settleLeftovers(tx, userId)) throw running();
      await claim(tx);
    })
    .catch((err: unknown) => {
      releaseActiveImport(importId, runId);
      throw err;
    });
}

/** Starts a copy of `range` (none: the whole history). 409 while one runs or without an own connection. */
export async function startDawarichCopy(
  userId: string,
  range: CopyRange,
  opts: CopyRunOptions = {}
): Promise<{ jobId: string; importId: string }> {
  if (!(await ownDawarichConnection(userId))) throw notConfigured();
  const { fromMs, untilMs } = resolveCopyRange(range);
  const importId = randomUUID();
  const runId = randomUUID();
  await claimed(userId, importId, runId, async (tx) => {
    // Owner, 2026-10-25: a paused copy is resumed or deleted first, never
    // silently replaced by a new one.
    const earlier = await tx.travTrackDawarichImport.findUnique({
      where: { userId },
      select: { status: true },
    });
    if (earlier && RESUMABLE.has(earlier.status)) {
      throw new AppError(
        "Resume the paused copy or delete it first",
        409,
        "TRAVTRACK_IMPORT_PAUSED"
      );
    }
    await tx.travTrackImport.create({
      data: { id: importId, userId, kind: "dawarich", fileName: "Dawarich", status: "running" },
    });
    const fields = {
      importId,
      status: "running",
      runId,
      fromDay: new Date(fromMs),
      untilDay: new Date(untilMs),
      nextDay: new Date(fromMs),
      daysDone: 0,
      report: {} as Prisma.InputJsonValue,
      lastErrorKind: null,
      heartbeatAt: new Date(),
      createdAt: new Date(),
      finishedAt: null,
    };
    await tx.travTrackDawarichImport.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
  });
  return launch(userId, runId, importId, opts);
}

/** Goes on from the checkpoint of a paused, interrupted or failed copy. */
export async function resumeDawarichCopy(
  userId: string,
  opts: CopyRunOptions = {}
): Promise<{ jobId: string; importId: string }> {
  if (!(await ownDawarichConnection(userId))) throw notConfigured();
  const current = await prisma.travTrackDawarichImport.findUnique({
    where: { userId },
    select: { importId: true },
  });
  if (!current) {
    throw new AppError("No Dawarich copy to resume", 404, "TRAVTRACK_IMPORT_NOT_FOUND");
  }
  const runId = randomUUID();
  const { importId } = current;
  await claimed(userId, importId, runId, async (tx) => {
    const row = await tx.travTrackDawarichImport.findUniqueOrThrow({ where: { userId } });
    if (row.importId !== importId || !RESUMABLE.has(row.status)) {
      throw new AppError("This copy cannot be resumed", 409, "TRAVTRACK_IMPORT_NOT_RESUMABLE");
    }
    await tx.travTrackDawarichImport.update({
      where: { userId },
      data: {
        status: "running",
        runId,
        lastErrorKind: null,
        heartbeatAt: new Date(),
        finishedAt: null,
      },
    });
    await tx.travTrackImport.update({
      where: { id: importId },
      data: { status: "running", finishedAt: null },
    });
  });
  return launch(userId, runId, importId, opts);
}

/** Pauses a running copy; its run stops before its next request. */
export async function stopDawarichCopy(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    await settleStale(tx, userId);
    const row = await tx.travTrackDawarichImport.findUnique({ where: { userId } });
    if (row?.status !== "running") {
      throw new AppError("No Dawarich copy is running", 409, "TRAVTRACK_IMPORT_NOT_RUNNING");
    }
    await tx.travTrackDawarichImport.update({
      where: { userId },
      data: { status: "paused", runId: null, lastErrorKind: null },
    });
    await tx.travTrackImport.updateMany({
      where: { id: row.importId, status: "running" },
      data: { status: "interrupted", finishedAt: new Date() },
    });
  });
}

/** What the account's Dawarich connection allows: an own one, only a shared one, or none. */
async function connectionKind(userId: string): Promise<"own" | "shared" | "none"> {
  if (await ownDawarichConnection(userId)) return "own";
  return (await getDawarichConnection(userId)) ? "shared" : "none";
}

/** The copy as the client shows it, with its report per month and the totals. */
export async function getDawarichCopy(userId: string) {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    await settleStale(tx, userId);
  });
  const [row, connection] = await Promise.all([
    prisma.travTrackDawarichImport.findUnique({ where: { userId } }),
    connectionKind(userId),
  ]);
  if (!row) return { connection, copy: null };
  const report = readReport(row.report);
  return {
    connection,
    copy: {
      importId: row.importId,
      status: row.status as CopyStatus,
      fromDay: dayKey(row.fromDay.getTime()),
      untilDay: dayKey(row.untilDay.getTime()),
      nextDay: dayKey(row.nextDay.getTime()),
      daysDone: row.daysDone,
      daysTotal: Math.round((row.untilDay.getTime() - row.fromDay.getTime()) / DAY_MS) + 1,
      lastErrorKind: (row.lastErrorKind as CopyErrorKind | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      totals: totalsOf(report),
      months: monthsOf(report),
    },
  };
}

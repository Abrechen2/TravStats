import { prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import {
  createDawarichClient,
  type DawarichClient,
  type DawarichPoint,
} from "../../dawarich/dawarichClient";
import { ownDawarichConnectionFor } from "../../dawarich/dawarichResolver";
import { DawarichError, type DawarichConnection } from "../../dawarich/errors";
import { isSharedDemoUser } from "../../../utils/sharedDemo";
import { travTrackInstanceOn, travTrackInstanceOnIn } from "../availability";
import { ingestPoints, type IngestResult } from "../ingest";
import { takeTravTrackLock } from "../lock";
import { importOrigin } from "./fileImport";
import { DAY_MS, readSpan, type DayHarvest, type ReadDeps } from "./dawarichRead";
import { addDay, asImportReport, isComplete, readReport, type CopyReport } from "./dawarichReport";

/**
 * The work of a Dawarich copy (TravTrack plan L6, review focus 30): the job
 * behind the click, resumable from the row's checkpoint after any stop.
 *
 * Per UTC day, oldest first, one transaction = the checkpoint protocol: the
 * day is read from Dawarich outside it (`dawarichRead.ts`); then, under the
 * account's TravTrack lock, the fence (this run still owns a `running` copy
 * whose import is still `running`, and TravTrack is on), the day's points
 * through the one ingest every source shares (zones, zone tombstones, deleted
 * spans and duplicates exactly as for the Companion), and the checkpoint and
 * the month's report — all in the same transaction. A crash repeats at most
 * that one day, and the repeat stores nothing twice. Every removal holds the
 * same lock, so a deletion lands wholly before or after a day, and its fence
 * or its tombstone wins.
 *
 * Dawarich is only read, through the account's own connection — never the
 * admin-global or ENV one, which would copy someone else's history. A
 * Dawarich failure pauses the copy with its kind; resume goes on from
 * `next_day`. The copy only stores points: it starts no stay, journey or
 * country question (review focus 19); the days it filled are marked dirty for
 * the projections by the ingest itself.
 */

/** The pause before every request to the account's Dawarich: a copy is a background reader. */
export const COPY_PAUSE_MS = 250;
/** Points per ingest call inside a day's transaction. */
export const COPY_BATCH = 5000;
/** The device the copied points are stored under. */
export const COPY_DEVICE = "dawarich";

export type CopyRunOptions = {
  /** Test seam: the client for the account's own connection. */
  clientFor?: (conn: DawarichConnection) => DawarichClient;
  pauseMs?: number;
  /** Test seam: after a day's transaction committed. */
  afterDay?: (day: string) => Promise<void>;
  /** Test seam: inside a day's transaction, before its checkpoint is written. */
  beforeCommit?: (day: string) => Promise<void>;
};

export type CopyStatus =
  "running" | "paused" | "interrupted" | "complete" | "incomplete" | "failed" | "cancelled";

/** Why a copy stopped short: a Dawarich error kind, or one of the copy's own. */
export type CopyErrorKind = DawarichError["kind"] | "disabled" | "notConfigured" | "internal";

export type CopyOutcome = { importId: string; status: CopyStatus };

type Ctx = { userId: string; runId: string; importId: string; fromMs: number };

/** This run no longer owns a running copy (stopped, deleted), or TravTrack went off. */
class CopyFenced extends Error {
  constructor(readonly reason: "gone" | "disabled") {
    super(`copy fenced: ${reason}`);
  }
}

/** The account's OWN Dawarich connection, or null — never the shared tiers. */
export async function ownDawarichConnection(userId: string): Promise<DawarichConnection | null> {
  if (await isSharedDemoUser(userId)) return null;
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  return ownDawarichConnectionFor(userId, settings?.dawarichBaseUrl, settings?.dawarichApiKey);
}

/** An optional reading kept only inside the range ingest takes; else unknown, never the point dropped. */
const within = (v: number | null, min: number, max: number): number | null =>
  v !== null && v >= min && v <= max ? v : null;

function toRaw(p: DawarichPoint): Record<string, unknown> {
  return {
    id: String(p.id),
    t: new Date(p.timestampMs).toISOString(),
    lat: p.latitude,
    lon: p.longitude,
    accuracy: within(p.accuracy, 0, 100_000),
    altitude: within(p.altitude, -1_000, 30_000),
    speed: within(p.velocity, 0, 1_000),
    purpose: "everyday",
  };
}

async function fence(tx: DbTransaction, ctx: Ctx) {
  const row = await tx.travTrackDawarichImport.findUnique({
    where: { userId: ctx.userId },
    select: { status: true, runId: true, importId: true, report: true },
  });
  if (row?.status !== "running" || row.runId !== ctx.runId || row.importId !== ctx.importId) {
    throw new CopyFenced("gone");
  }
  const imp = await tx.travTrackImport.findUnique({
    where: { id: ctx.importId },
    select: { status: true },
  });
  if (imp?.status !== "running") throw new CopyFenced("gone");
  if (!(await travTrackInstanceOnIn(tx))) throw new CopyFenced("disabled");
  return row;
}

async function checkpoint(tx: DbTransaction, ctx: Ctx, nextMs: number, report: CopyReport) {
  await tx.travTrackDawarichImport.update({
    where: { userId: ctx.userId },
    data: {
      nextDay: new Date(nextMs),
      daysDone: Math.round((nextMs - ctx.fromMs) / DAY_MS),
      report: report as unknown as Prisma.InputJsonValue,
      heartbeatAt: new Date(),
    },
  });
  await tx.travTrackImport.update({
    where: { id: ctx.importId },
    data: { report: asImportReport(report) as unknown as Prisma.InputJsonValue },
  });
}

const TX = { timeout: 120_000 };

async function commitDay(ctx: Ctx, day: DayHarvest, opts: CopyRunOptions): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, ctx.userId);
    const row = await fence(tx, ctx);
    const raw = day.points.map(toRaw);
    const results: IngestResult[] = [];
    for (let at = 0; at < raw.length; at += COPY_BATCH) {
      const { result } = await ingestPoints({
        userId: ctx.userId,
        origin: importOrigin("dawarich", ctx.importId),
        deviceId: COPY_DEVICE,
        uploadId: null,
        points: raw.slice(at, at + COPY_BATCH),
        outer: tx,
      });
      results.push(result);
    }
    const report = addDay(readReport(row.report), day, results);
    await opts.beforeCommit?.(day.day);
    await checkpoint(tx, ctx, day.startMs + DAY_MS, report);
  }, TX);
}

/** Moves the checkpoint over days that held nothing. */
async function commitEmpty(ctx: Ctx, nextMs: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, ctx.userId);
    const row = await fence(tx, ctx);
    await checkpoint(tx, ctx, nextMs, readReport(row.report));
  }, TX);
}

/** Before every request: TravTrack still on, the run still owns the copy, and its heartbeat. */
async function beat(ctx: Ctx): Promise<void> {
  if (!(await travTrackInstanceOn())) throw new CopyFenced("disabled");
  const { count } = await prisma.travTrackDawarichImport.updateMany({
    where: { userId: ctx.userId, runId: ctx.runId, status: "running" },
    data: { heartbeatAt: new Date() },
  });
  if (count === 0) throw new CopyFenced("gone");
}

async function outcomeOf(ctx: Ctx): Promise<CopyOutcome> {
  const row = await prisma.travTrackDawarichImport.findUnique({
    where: { userId: ctx.userId },
    select: { status: true, importId: true },
  });
  const status =
    row?.importId === ctx.importId ? (row.status as CopyStatus) : ("cancelled" as const);
  return { importId: ctx.importId, status };
}

/** Ends this run as paused or failed — only while it still owns a running copy. */
async function settle(
  ctx: Ctx,
  status: "paused" | "failed",
  kind: CopyErrorKind
): Promise<CopyOutcome> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, ctx.userId);
    const { count } = await tx.travTrackDawarichImport.updateMany({
      where: { userId: ctx.userId, runId: ctx.runId, status: "running" },
      data: {
        status,
        lastErrorKind: kind,
        runId: null,
        finishedAt: status === "failed" ? now : null,
      },
    });
    if (count === 0) return;
    await tx.travTrackImport.updateMany({
      where: { id: ctx.importId, status: "running" },
      data: { status: status === "failed" ? "failed" : "interrupted", finishedAt: now },
    });
  });
  return outcomeOf(ctx);
}

/** The whole range is copied: complete or incomplete, and the import's span. */
async function finish(ctx: Ctx): Promise<CopyOutcome> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, ctx.userId);
    const row = await fence(tx, ctx);
    const report = readReport(row.report);
    const now = new Date();
    const span = await tx.travTrackPoint.aggregate({
      where: { userId: ctx.userId, origin: importOrigin("dawarich", ctx.importId) },
      _min: { t: true },
      _max: { t: true },
    });
    await tx.travTrackDawarichImport.update({
      where: { userId: ctx.userId },
      data: {
        status: isComplete(report) ? "complete" : "incomplete",
        runId: null,
        lastErrorKind: null,
        finishedAt: now,
      },
    });
    await tx.travTrackImport.update({
      where: { id: ctx.importId },
      data: {
        status: "succeeded",
        finishedAt: now,
        fromAt: span._min.t,
        toAt: span._max.t,
      },
    });
  }, TX);
  return outcomeOf(ctx);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const startOfNextUtcMonth = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};

/** Reads and stores from the checkpoint to the end of the range, a month window at a time. */
async function copyFromCheckpoint(ctx: Ctx, deps: ReadDeps, opts: CopyRunOptions) {
  const row = await prisma.travTrackDawarichImport.findUniqueOrThrow({
    where: { userId: ctx.userId },
    select: { nextDay: true, untilDay: true },
  });
  const end = row.untilDay.getTime() + DAY_MS;
  for (let next = row.nextDay.getTime(); next < end;) {
    const spanEnd = Math.min(startOfNextUtcMonth(next), end);
    let cursor = next;
    for await (const day of readSpan(deps, next, spanEnd)) {
      await commitDay(ctx, day, opts);
      cursor = day.startMs + DAY_MS;
      await opts.afterDay?.(day.day);
    }
    if (cursor < spanEnd) await commitEmpty(ctx, spanEnd);
    next = spanEnd;
  }
}

/** One run of a copy, from its checkpoint; the job's work. */
export async function runDawarichCopy(
  userId: string,
  runId: string,
  importId: string,
  opts: CopyRunOptions = {}
): Promise<CopyOutcome> {
  const start = await prisma.travTrackDawarichImport.findUniqueOrThrow({
    where: { userId },
    select: { fromDay: true },
  });
  const ctx: Ctx = { userId, runId, importId, fromMs: start.fromDay.getTime() };
  const conn = await ownDawarichConnection(userId);
  if (!conn) return settle(ctx, "failed", "notConfigured");
  const client = (opts.clientFor ?? createDawarichClient)(conn);
  const pauseMs = opts.pauseMs ?? COPY_PAUSE_MS;
  const deps: ReadDeps = {
    client,
    beforeRequest: async () => {
      await beat(ctx);
      if (pauseMs > 0) await sleep(pauseMs);
    },
  };
  try {
    await copyFromCheckpoint(ctx, deps, opts);
    return await finish(ctx);
  } catch (err) {
    if (err instanceof CopyFenced) {
      return err.reason === "disabled" ? settle(ctx, "paused", "disabled") : outcomeOf(ctx);
    }
    // Never the message: a Dawarich message can carry the base URL, a home's address.
    if (err instanceof DawarichError) {
      logger.warn({ operation: "travtrack.dawarichCopy.paused", importId, kind: err.kind });
      return settle(ctx, "paused", err.kind);
    }
    logger.error({
      operation: "travtrack.dawarichCopy.failed",
      importId,
      error: err instanceof Error ? err.name : "unknown",
    });
    await settle(ctx, "failed", "internal");
    throw err;
  }
}

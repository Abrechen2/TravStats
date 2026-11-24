import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

import { expectingBusyWait, prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";
import { jobErrorOf, startJob } from "../../jobs/jobRegistry";
import { positionKey, type DropReason } from "../classify";
import { onPointsRemoved } from "../deleteRange";
import { utcDaysOf } from "../dirtyDays";
import { ingestPoints, type IngestResult } from "../ingest";
import { takeTravTrackLock } from "../lock";
import type { GpxWorkerOptions } from "./gpxWorker";
import {
  importEndStatus,
  isTransientDbError,
  paceAfter,
  sleep as realSleep,
  type Sleep,
} from "./importPacing";
import { displayFileName } from "./mapGpx";
import { FairSlot, importWriteSlot, SLICE_BATCHES, SLICE_MS } from "./writeSlot";
import { discardSpool, readHead, spoolBuffer } from "./spool";
import { readTrackFile, type MappedTrack } from "./trackFile";
import { assertImportSize, sniffFormat } from "./trackFormat";
import { readerQueueFull, busy } from "./trackFileChild";

/**
 * A file imported into TravTrack (TravTrack plan E8). The request stores the
 * import's row and answers with a job; the job reads the file and stores its
 * fixes through the one ingest every source shares, in batches, each batch
 * fenced on "this import is still running" under the account's TravTrack
 * lock — so deleting the import stops it between two batches, and nothing
 * stored after the delete.
 *
 * Deleting an import removes the points of its origin and nothing else: no
 * tombstone (another source's points in the same span stay, and the same file
 * may be imported again), and a fix the phone had sent already was never
 * stored under this origin, so the phone's copy stays.
 *
 * An import never triggers a stay, country or journey scan of its span and
 * never prompts (review focus 19): it only stores points.
 *
 * Sharing the database (2026-11-24, a 45 MB Google Timeline held prod at load
 * 15 for seven minutes and then failed on a 347 s transaction): a batch is
 * small, commits on its own together with the import's cursor and report, and
 * waits for the account's lock only so long — a batch that could not get it is
 * retried after a pause. After every batch the job sleeps as long as the batch
 * took (`importPacing.ts`). An import that stops mid-way is `partial` and
 * resumes at its cursor when the same file is given again.
 */

export const IMPORT_BATCH_SIZE = 1000;
/** A batch's own transaction: far below the 60 s ingest default. */
const BATCH_TX_TIMEOUT_MS = 30_000;
/** How long a batch waits for the account's lock (and each statement twice that). */
const BATCH_LOCK_TIMEOUT_MS = 10_000;
/** Tries per batch when the database was only busy; then the import stops as `partial`. */
const BATCH_ATTEMPTS = 4;
/** The pause before the second try; doubled for each further one. */
const BATCH_RETRY_MS = 2_000;

/** The minutes two removed points may lie apart and still count as one span. */
const SPAN_JOIN_MS = 30 * 60_000;

export type ImportReport = {
  read: number;
  stored: number;
  duplicate: number;
  dropped: Record<DropReason, number>;
  withoutTime: number;
  /** What the file was read as, e.g. `gpx`, `google-records` (absent on imports before forgejo#394). */
  format?: string;
  /** The failure's code, when the import failed. */
  error?: string;
  /** The run stored nothing new (every fix a duplicate or dropped): not progress. */
  noNewPoints?: boolean;
  /** Waiting for its turn behind another account's import; its points are let go meanwhile. */
  queued?: boolean;
};

export type ImportOutcome = {
  importId: string;
  status: "succeeded" | "partial" | "cancelled";
  report: ImportReport;
};

/**
 * The imports this process is working on — a GPX file's and a Dawarich copy's
 * (`dawarichImport.ts`) — each with the run that owns it (a GPX import is its
 * own run; a copy's run id changes with every resume). A `running` row not in
 * here is left over from a restart. Only the owner releases an entry, so a
 * refused second claim cannot unregister a live run (Codex review of L6).
 */
export const activeImports = new Map<string, string>();
const active = activeImports;

/** Releases `importId` only when `owner` still holds it. */
export function releaseActiveImport(importId: string, owner: string): void {
  if (activeImports.get(importId) === owner) activeImports.delete(importId);
}

const emptyReport = (): ImportReport => ({
  read: 0,
  stored: 0,
  duplicate: 0,
  dropped: { privacy_zone: 0, deleted_range: 0, invalid: 0, null_island: 0 },
  withoutTime: 0,
});

class ImportCancelled extends Error {
  constructor() {
    super("import cancelled");
  }
}

const notFound = () =>
  new AppError("No such import of this account", 404, "TRAVTRACK_IMPORT_NOT_FOUND");

/** The report with one committed batch added. */
function withBatch(report: ImportReport, result: IngestResult): ImportReport {
  const dropped = { ...report.dropped };
  for (const o of result.outcomes) if (o.outcome === "dropped") dropped[o.reason] += 1;
  return {
    ...report,
    stored: report.stored + result.stored,
    duplicate: report.duplicate + result.duplicate,
    dropped,
  };
}

/** A stored report read back for a resume; anything unreadable counts from zero. */
function reportFrom(json: unknown): ImportReport {
  const base = emptyReport();
  if (!json || typeof json !== "object") return base;
  const r = json as Partial<ImportReport>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    ...base,
    stored: n(r.stored),
    duplicate: n(r.duplicate),
    dropped: {
      privacy_zone: n(r.dropped?.privacy_zone),
      deleted_range: n(r.dropped?.deleted_range),
      invalid: n(r.dropped?.invalid),
      null_island: n(r.dropped?.null_island),
    },
  };
}

/** SHA-256 of the file, streamed: a resume continues at the cursor only for the same bytes. */
async function fileDigest(input: Buffer | { path: string }): Promise<string> {
  const hash = createHash("sha256");
  if (Buffer.isBuffer(input)) return hash.update(input).digest("hex");
  for await (const chunk of createReadStream(input.path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Writes the outcome only while the row is still `running`: a delete meanwhile wins. */
async function finish(
  importId: string,
  data: {
    status: "succeeded" | "partial" | "failed";
    report: ImportReport;
    fromAt?: Date;
    toAt?: Date;
  }
): Promise<boolean> {
  const { count } = await prisma.travTrackImport.updateMany({
    where: { id: importId, status: "running" },
    data: {
      ...data,
      report: data.report as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
  return count > 0;
}

export type RunOptions = {
  batchSize?: number;
  /** The reader's limits (tests lower them). */
  reader?: GpxWorkerOptions;
  /** Percent done, 0-100: reading the file is the first half, storing its points the second. */
  onProgress?: (percent: number) => void;
  /** Test seam: after each committed batch, with the number of batches done. */
  afterBatch?: (done: number) => Promise<void>;
  /** Test seam: each committed batch's first point, size and wall time (its transaction included). */
  onBatch?: (batch: { at: number; size: number; durationMs: number }) => void;
  /** Continue at the row's cursor when the file is the one it was started with. */
  resume?: boolean;
  /** The pause between batches and before a retry (tests record it instead of waiting). */
  sleep?: Sleep;
  /** How long a batch waits for the account's lock (tests shorten it). */
  lockTimeoutMs?: number;
  /** The turn at storing points (tests give their own). */
  slot?: FairSlot;
  /** Batches, and milliseconds, one turn lasts at most (tests shorten them). */
  sliceBatches?: number;
  sliceMs?: number;
  /** Test seam: after each parse of the file (once, plus once per turn given away). */
  onParse?: () => void;
  /** Test seam: right before the import queues again, with whether it still holds points. */
  onYield?: (state: { holdsPoints: boolean }) => void;
};

/**
 * The job's work. `file` is a holder so the buffer can be let go once read:
 * an import's memory is the file until it is parsed, then its points.
 */
export async function runGpxImport(
  importId: string,
  userId: string,
  file: { buffer?: Buffer | null; path?: string },
  opts: RunOptions = {}
): Promise<ImportOutcome> {
  const state: RunState = { report: emptyReport(), cursor: 0, completed: false };
  try {
    const input = file.path ? { path: file.path } : (file.buffer ?? Buffer.alloc(0));
    file.buffer = null;
    const digest = await fileDigest(input);
    const prior = await prisma.travTrackImport.findFirst({
      where: { id: importId, userId },
      select: { cursor: true, report: true, fileSha256: true },
    });
    const resuming = opts.resume === true && prior?.fileSha256 === digest && prior.cursor > 0;
    if (resuming) {
      state.cursor = prior.cursor;
      state.report = reportFrom(prior.report);
    }
    const slot = opts.slot ?? importWriteSlot;
    // The turn first, the parse second: an import waiting for its turn holds
    // the spooled file and its cursor, never the parsed points (`writeSlot.ts`).
    await slot.acquire(userId);
    let span: { fromMs: number | null; untilMs: number | null };
    try {
      span = await storeInTurns(importId, userId, input, digest, resuming, state, slot, opts);
    } finally {
      slot.release();
    }
    state.completed = true;
    const report = finalReport(state.report);
    const finished = await finish(importId, {
      status: "succeeded",
      report,
      ...(span.fromMs !== null ? { fromAt: new Date(span.fromMs) } : {}),
      ...(span.untilMs !== null ? { toAt: new Date(span.untilMs) } : {}),
    });
    return { importId, status: finished ? "succeeded" : "cancelled", report };
  } catch (err) {
    if (err instanceof ImportCancelled) {
      return { importId, status: "cancelled", report: state.report };
    }
    const code = jobErrorOf(err).code;
    const { cursor } = state;
    const status = importEndStatus({
      completed: state.completed,
      cursor,
      stored: state.report.stored,
    });
    const ended = { ...finalReport(state.report), error: code };
    try {
      await finish(importId, { status, report: ended });
    } catch (writeErr) {
      logger.error({
        operation: "travtrack.import.finish_failed",
        importId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }
    logger.warn({ operation: "travtrack.import.stopped", importId, status, cursor, code });
    // Stored points are not a failure: the job answers with the partial report.
    if (status === "partial") return { importId, status: "partial", report: ended };
    throw err;
  }
}

type RunState = { report: ImportReport; cursor: number; completed: boolean };

/** The report as it ends: a run that stored nothing new says so instead of looking like progress. */
function finalReport(report: ImportReport): ImportReport {
  const rest = withoutQueued(report);
  return rest.stored === 0 ? { ...rest, noNewPoints: true } : rest;
}

/**
 * Parses the file and stores its points in turns. At a slice end with another
 * import waiting, the parsed points are let go before this import queues
 * again, and the file is parsed anew when its turn comes back.
 */
async function storeInTurns(
  importId: string,
  userId: string,
  input: Buffer | { path: string },
  digest: string,
  resuming: boolean,
  state: RunState,
  slot: FairSlot,
  opts: RunOptions
): Promise<{ fromMs: number | null; untilMs: number | null }> {
  const origin = `gpx:${importId}`;
  const wait = opts.sleep ?? realSleep;
  const fence = async (tx: DbTransaction) => {
    const row = await tx.travTrackImport.findFirst({
      where: { id: importId, userId },
      select: { status: true },
    });
    if (row?.status !== "running") throw new ImportCancelled();
  };
  const parse = async (first: boolean): Promise<MappedTrack> => {
    const { track } = await readTrackFile(input, {
      ...opts.reader,
      // Only the first parse reports reading progress: a re-parse would set the bar back.
      onProgress: first
        ? (done, total) => opts.onProgress?.(Math.floor((done / Math.max(total, 1)) * 50))
        : undefined,
    });
    opts.onParse?.();
    return track;
  };
  let mapped: MappedTrack | null = await parse(true);
  state.report = {
    ...state.report,
    format: mapped.formats.join("+"),
    read: mapped.read,
    withoutTime: mapped.withoutTime,
    // On a resume the stored count already holds the reader's invalid fixes.
    dropped: resuming ? state.report.dropped : { ...state.report.dropped, invalid: mapped.invalid },
  };
  if (mapped.count === 0) {
    throw new AppError("The file holds no point with a time", 422, "TRAVTRACK_IMPORT_NO_TIMES");
  }
  const total = mapped.count;
  const span = { fromMs: mapped.fromMs, untilMs: mapped.untilMs };
  await writeProgress(importId, state, { fileSha256: digest });
  const size = opts.batchSize ?? IMPORT_BATCH_SIZE;
  const sliceBatches = opts.sliceBatches ?? SLICE_BATCHES;
  const sliceMs = opts.sliceMs ?? SLICE_MS;
  let sliceStart = performance.now();
  let inSlice = 0;
  for (let done = 0; state.cursor < total;) {
    mapped ??= await parse(false);
    const at = state.cursor;
    const next = Math.min(at + size, total);
    const started = performance.now();
    state.report = await storeBatch({
      userId,
      importId,
      origin,
      points: mapped.batch(at, size),
      fence,
      report: state.report,
      cursorAfter: next,
      wait,
      lockTimeoutMs: opts.lockTimeoutMs ?? BATCH_LOCK_TIMEOUT_MS,
    });
    state.cursor = next;
    const durationMs = performance.now() - started;
    done += 1;
    opts.onBatch?.({ at, size: next - at, durationMs });
    opts.onProgress?.(50 + Math.floor((state.cursor / total) * 50));
    await opts.afterBatch?.(done);
    if (state.cursor >= total) break;
    await wait(paceAfter(durationMs));
    inSlice += 1;
    if (inSlice < sliceBatches && performance.now() - sliceStart < sliceMs) continue;
    if (slot.waiting() > 0) {
      // The slice is over and another import waits: let the points go, queue
      // behind it, and carry on from the committed cursor when the turn is back.
      mapped = null;
      state.report = { ...state.report, queued: true };
      await writeProgress(importId, state);
      opts.onYield?.({ holdsPoints: mapped !== null });
      await slot.yieldTurn(userId);
      state.report = withoutQueued(state.report);
    }
    sliceStart = performance.now();
    inSlice = 0;
  }
  return span;
}

function withoutQueued(report: ImportReport): ImportReport {
  const { queued: _queued, ...rest } = report;
  return rest;
}

/** The row's cursor and report as they stand (only while it is still running). */
async function writeProgress(
  importId: string,
  state: RunState,
  extra: { fileSha256?: string } = {}
): Promise<void> {
  await prisma.travTrackImport.updateMany({
    where: { id: importId, status: "running" },
    data: {
      ...extra,
      cursor: state.cursor,
      report: state.report as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * One batch in its own short transaction, the import's cursor and report
 * committed with its points. Busy (lock or statement timeout, an expired
 * transaction) is retried after a growing pause; anything else, or the last
 * try, is thrown and the import stops with what it has.
 */
async function storeBatch(b: {
  userId: string;
  importId: string;
  origin: string;
  points: Record<string, unknown>[];
  fence: (tx: DbTransaction) => Promise<void>;
  report: ImportReport;
  cursorAfter: number;
  wait: Sleep;
  lockTimeoutMs: number;
}): Promise<ImportReport> {
  for (let attempt = 1; ; attempt++) {
    let next = b.report;
    const last = attempt >= BATCH_ATTEMPTS;
    try {
      // An expected busy wait is the caller's to report (one warning per retry);
      // only the last try's failure reaches the error log.
      const ingest = () =>
        ingestPoints({
          userId: b.userId,
          origin: b.origin,
          deviceId: `file:${b.importId}`,
          uploadId: null,
          points: b.points,
          fence: b.fence,
          timeoutMs: BATCH_TX_TIMEOUT_MS,
          lockTimeoutMs: b.lockTimeoutMs,
          afterIn: async (tx, result) => {
            next = withBatch(b.report, result);
            await tx.travTrackImport.update({
              where: { id: b.importId },
              data: {
                cursor: b.cursorAfter,
                report: next as unknown as Prisma.InputJsonValue,
              },
            });
          },
        });
      await (last ? ingest() : expectingBusyWait(ingest));
      return next;
    } catch (err) {
      if (!isTransientDbError(err)) throw err;
      if (last) {
        logger.error({
          operation: "travtrack.import.batch_failed",
          importId: b.importId,
          attempt,
          cursor: b.cursorAfter,
        });
        throw err;
      }
      logger.warn({
        operation: "travtrack.import.batch_busy",
        importId: b.importId,
        attempt,
        cursor: b.cursorAfter,
      });
      await b.wait(BATCH_RETRY_MS * 2 ** (attempt - 1));
    }
  }
}

/** Marks this account's `running` rows no process works on as interrupted; true when one really runs. */
export async function settleLeftovers(tx: DbTransaction, userId: string): Promise<boolean> {
  const running = await tx.travTrackImport.findMany({
    where: { userId, status: "running" },
    select: { id: true },
  });
  const stale = running.filter((r) => !active.has(r.id)).map((r) => r.id);
  if (stale.length > 0) {
    // A file import that committed a batch before the restart is `partial`:
    // its cursor says where a resume picks up. One that stored nothing (and
    // a Dawarich copy, which keeps its own checkpoint) stays `interrupted`.
    await tx.$executeRaw`
      UPDATE travtrack_imports
         SET status = CASE WHEN kind = 'gpx' AND cursor > 0 THEN 'partial' ELSE 'interrupted' END,
             report = CASE WHEN kind = 'gpx' AND cursor > 0
                           THEN jsonb_set(COALESCE(report, '{}'::jsonb), '{error}', '"TRAVTRACK_IMPORT_INTERRUPTED"')
                           ELSE report END,
             finished_at = now()
       WHERE id = ANY(${stale}::text[]) AND status = 'running'`;
  }
  return running.length > stale.length;
}

/** The account's imports, newest first; a leftover of a restart reads as interrupted. */
export async function listTravTrackImports(userId: string) {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    await settleLeftovers(tx, userId);
  });
  return prisma.travTrackImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      fileName: true,
      status: true,
      report: true,
      cursor: true,
      fromAt: true,
      toAt: true,
      createdAt: true,
      finishedAt: true,
    },
  });
}

/**
 * Starts a file import (GPX, Google Timeline, GeoJSON, KML, TCX; kind `gpx` for all, the
 * report's `format` says which): the row first, under the lock (one running import per
 * account, else 409 `TRAVTRACK_IMPORT_RUNNING`), then the job.
 */
export async function startGpxImport(
  userId: string,
  file: ({ buffer: Buffer } | { path: string; size: number }) & {
    originalName: string | undefined;
  },
  opts: RunOptions & {
    beforeRun?: () => Promise<void>;
    /** Test seam: lowers the size caps. */
    maxBytes?: { json?: number; xml?: number };
    /** Resume this stopped import (`partial`, `failed`, `interrupted`) with the file given again. */
    resumeOf?: string;
  } = {}
): Promise<{ jobId: string; importId: string }> {
  // The service owns the spooled file from here on: it is removed on every refusal
  // and when the job ends, whatever the job's outcome.
  let spooled: string | null = null;
  let slotHeld = false;
  try {
    if ("buffer" in file) {
      assertImportSize(sniffFormat(file.buffer), file.buffer.length, opts.maxBytes);
      spooled = await spoolBuffer(file.buffer);
    } else {
      spooled = file.path;
      assertImportSize(sniffFormat(await readHead(spooled)), file.size, opts.maxBytes);
    }
    if (readerQueueFull() || fileImportsFull()) {
      // This account's own import is the reason: say so (409), not "the server is busy".
      if (await hasLiveImport(userId)) {
        throw new AppError("An import is running already", 409, "TRAVTRACK_IMPORT_RUNNING");
      }
      throw busy();
    }
    // Reserve the slot in the same tick as the check: two requests awaiting
    // createRunningImport would otherwise both pass a full-minus-one check.
    fileImportsRunning += 1;
    slotHeld = true;
    const importId =
      opts.resumeOf !== undefined
        ? await reopenImport(userId, opts.resumeOf, await fileDigest({ path: spooled }))
        : await createRunningImport(userId, file.originalName);
    const path = spooled;
    const job = startJob("travtrack.fileImport", userId, async (reportProgress) => {
      try {
        await opts.beforeRun?.();
        return await runGpxImport(
          importId,
          userId,
          { path },
          {
            ...opts,
            resume: opts.resumeOf !== undefined,
            onProgress: (percent) => reportProgress(percent, 100),
          }
        );
      } finally {
        releaseActiveImport(importId, importId);
        if (slotHeld) {
          slotHeld = false;
          fileImportsRunning -= 1;
        }
        discardSpool(path);
      }
    });
    spooled = null;
    return { jobId: job.id, importId };
  } catch (err) {
    // A refusal before the job took over (409 from createRunningImport, a throw
    // from startJob) gives the slot back here; afterwards the job's finally does.
    if (slotHeld && spooled !== null) {
      slotHeld = false;
      fileImportsRunning -= 1;
    }
    discardSpool(spooled);
    throw err;
  }
}

/** The import's row first, under the lock (one running import per account, else 409). */
async function createRunningImport(userId: string, originalName: string | undefined) {
  const importId = randomUUID();
  await prisma
    .$transaction(async (tx) => {
      await takeTravTrackLock(tx, userId);
      if (await settleLeftovers(tx, userId)) {
        throw new AppError("An import is running already", 409, "TRAVTRACK_IMPORT_RUNNING");
      }
      // Marked before the commit: a second request waiting on the lock must
      // see this row as worked on, not as a leftover.
      active.set(importId, importId);
      await tx.travTrackImport.create({
        data: {
          id: importId,
          userId,
          kind: "gpx",
          fileName: displayFileName(originalName),
          status: "running",
        },
      });
    })
    .catch((err: unknown) => {
      releaseActiveImport(importId, importId);
      throw err;
    });
  return importId;
}

/** Statuses a file import can be resumed from. */
const RESUMABLE = ["partial", "failed", "interrupted"];

/**
 * A stopped file import back to `running`, under the lock and with the same
 * one-running-import rule as a new one. Its origin stays, so the points it has
 * stored already answer as duplicates; the cursor is kept for the run to use
 * when the file is the same.
 */
async function reopenImport(userId: string, importId: string, digest: string): Promise<string> {
  await prisma
    .$transaction(async (tx) => {
      await takeTravTrackLock(tx, userId);
      if (await settleLeftovers(tx, userId)) {
        throw new AppError("An import is running already", 409, "TRAVTRACK_IMPORT_RUNNING");
      }
      const row = await tx.travTrackImport.findFirst({
        where: { id: importId, userId },
        select: { kind: true, status: true, fileSha256: true },
      });
      if (!row) throw notFound();
      // Another file under this import's origin would mix two files' points into
      // one import. Only a row from before the digest existed takes any file.
      if (row.fileSha256 !== null && row.fileSha256 !== digest) {
        throw new AppError(
          "This is not the file the import was started with",
          409,
          "TRAVTRACK_IMPORT_FILE_MISMATCH"
        );
      }
      if (row.kind !== "gpx" || !RESUMABLE.includes(row.status)) {
        throw new AppError("This import cannot be resumed", 409, "TRAVTRACK_IMPORT_NOT_RESUMABLE");
      }
      active.set(importId, importId);
      await tx.travTrackImport.update({
        where: { id: importId },
        data: { status: "running", finishedAt: null },
      });
    })
    .catch((err: unknown) => {
      releaseActiveImport(importId, importId);
      throw err;
    });
  return importId;
}

/**
 * File imports between "accepted" and "finished": the points of each wait in
 * memory until stored. Only one of them stores at a time, in slices that go
 * round the accounts (`writeSlot.ts`): two at once would only compete for the
 * same disk, and one account's large file must not keep another's waiting.
 */
export const MAX_FILE_IMPORTS = 3;
let fileImportsRunning = 0;

/** True when no further file import is taken: reading AND storing are bounded, not only reading. */
export const fileImportsFull = (): boolean => fileImportsRunning >= MAX_FILE_IMPORTS;

/**
 * Whether this account has an import a process is working on — asked BEFORE the
 * upload is accepted, so a second file is refused (409) without its body being
 * read. Advisory: `createRunningImport` stays the authority under the lock.
 */
export async function hasLiveImport(userId: string): Promise<boolean> {
  const running = await prisma.travTrackImport.findMany({
    where: { userId, status: "running" },
    select: { id: true },
  });
  return running.some((r) => active.has(r.id));
}

/** The origin an import's points are stored under: `gpx:<id>` or `dawarich:<id>`. */
export const importOrigin = (kind: string, importId: string): string => `${kind}:${importId}`;

/** The removed points' instants as spans, two instants within `SPAN_JOIN_MS` in one. */
function spansOf(times: readonly Date[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const t of times) {
    const ms = t.getTime();
    const last = spans[spans.length - 1];
    if (last && ms - last[1] <= SPAN_JOIN_MS) last[1] = ms;
    else spans.push([ms, ms]);
  }
  return spans;
}

/**
 * Deletes an import: under the lock, the row becomes `cancelled` (a running
 * import's next batch fails its fence), the points of its origin go, and the
 * removal hook runs with their spans. No tombstone.
 */
export async function deleteTravTrackImport(
  userId: string,
  importId: string
): Promise<{ deleted: number }> {
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const row = await tx.travTrackImport.findFirst({
        where: { id: importId, userId },
        select: { id: true, kind: true, finishedAt: true },
      });
      if (!row) throw notFound();
      const finishedAt = row.finishedAt ?? new Date();
      await tx.travTrackImport.update({
        where: { id: row.id },
        data: { status: "cancelled", finishedAt },
      });
      // A Dawarich copy's checkpoint row goes `cancelled` too, in this
      // transaction: its next day's fence fails and stores nothing (plan L6).
      await tx.travTrackDawarichImport.updateMany({
        where: { importId, userId },
        data: { status: "cancelled", runId: null, finishedAt },
      });
      const origin = importOrigin(row.kind, importId);
      const removed = await tx.travTrackPoint.findMany({
        where: { userId, origin },
        orderBy: { t: "asc" },
        select: { t: true, tS: true, lat: true, lon: true },
      });
      if (removed.length === 0) return { deleted: 0 };
      const { count } = await tx.travTrackPoint.deleteMany({ where: { userId, origin } });
      // History went: the hook raises the generation (a derivation that read
      // before this must not publish after it), takes the open questions of
      // these points with it and gives their days back to the projections (E5).
      await onPointsRemoved(tx, userId, {
        kind: "origin",
        origin,
        keys: new Set(removed.map((r) => positionKey(r))),
        spans: spansOf(removed.map((r) => r.t)),
        days: utcDaysOf(removed.map((r) => r.t.getTime())),
      });
      return { deleted: count };
    },
    { timeout: 60_000 }
  );
}

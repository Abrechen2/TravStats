import { randomUUID } from "node:crypto";

import { prisma, type DbTransaction } from "../../../db";
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
import { displayFileName } from "./mapGpx";
import { discardSpool, readHead, spoolBuffer } from "./spool";
import { readTrackFile } from "./trackFile";
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
 */

export const IMPORT_BATCH_SIZE = 5000;

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
};

export type ImportOutcome = {
  importId: string;
  status: "succeeded" | "cancelled";
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

function addBatch(report: ImportReport, result: IngestResult): void {
  report.stored += result.stored;
  report.duplicate += result.duplicate;
  for (const o of result.outcomes) if (o.outcome === "dropped") report.dropped[o.reason] += 1;
}

/** Writes the outcome only while the row is still `running`: a delete meanwhile wins. */
async function finish(
  importId: string,
  data: { status: "succeeded" | "failed"; report: ImportReport; fromAt?: Date; toAt?: Date }
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
  const report = emptyReport();
  const origin = `gpx:${importId}`;
  const fence = async (tx: DbTransaction) => {
    const row = await tx.travTrackImport.findFirst({
      where: { id: importId, userId },
      select: { status: true },
    });
    if (row?.status !== "running") throw new ImportCancelled();
  };
  try {
    const input = file.path ? { path: file.path } : (file.buffer ?? Buffer.alloc(0));
    file.buffer = null;
    const { track: mapped } = await readTrackFile(input, {
      ...opts.reader,
      onProgress: (done, total) => opts.onProgress?.(Math.floor((done / Math.max(total, 1)) * 50)),
    });
    report.format = mapped.formats.join("+");
    report.read = mapped.read;
    report.dropped.invalid = mapped.invalid;
    report.withoutTime = mapped.withoutTime;
    if (mapped.count === 0) {
      throw new AppError("The file holds no point with a time", 422, "TRAVTRACK_IMPORT_NO_TIMES");
    }
    const size = opts.batchSize ?? IMPORT_BATCH_SIZE;
    for (let at = 0, done = 0; at < mapped.count; at += size) {
      const { result } = await ingestPoints({
        userId,
        origin,
        deviceId: `file:${importId}`,
        uploadId: null,
        points: mapped.batch(at, size),
        fence,
      });
      addBatch(report, result);
      done += 1;
      opts.onProgress?.(50 + Math.floor((Math.min(at + size, mapped.count) / mapped.count) * 50));
      await opts.afterBatch?.(done);
    }
    const finished = await finish(importId, {
      status: "succeeded",
      report,
      ...(mapped.fromMs !== null ? { fromAt: new Date(mapped.fromMs) } : {}),
      ...(mapped.untilMs !== null ? { toAt: new Date(mapped.untilMs) } : {}),
    });
    return { importId, status: finished ? "succeeded" : "cancelled", report };
  } catch (err) {
    if (err instanceof ImportCancelled) return { importId, status: "cancelled", report };
    const code = jobErrorOf(err).code;
    try {
      await finish(importId, { status: "failed", report: { ...report, error: code } });
    } catch (writeErr) {
      logger.error({
        operation: "travtrack.import.finish_failed",
        importId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }
    throw err;
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
    await tx.travTrackImport.updateMany({
      where: { id: { in: stale }, status: "running" },
      data: { status: "interrupted", finishedAt: new Date() },
    });
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
    if (readerQueueFull() || fileImportsFull()) throw busy();
    // Reserve the slot in the same tick as the check: two requests awaiting
    // createRunningImport would otherwise both pass a full-minus-one check.
    fileImportsRunning += 1;
    slotHeld = true;
    const importId = await createRunningImport(userId, file.originalName);
    const path = spooled;
    const job = startJob("travtrack.fileImport", userId, async (reportProgress) => {
      try {
        await opts.beforeRun?.();
        return await runGpxImport(
          importId,
          userId,
          { path },
          { ...opts, onProgress: (percent) => reportProgress(percent, 100) }
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

/** File imports between "accepted" and "finished": the points of each wait in memory until stored. */
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

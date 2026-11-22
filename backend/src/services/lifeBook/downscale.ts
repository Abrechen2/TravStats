import { Worker } from "worker_threads";

import logger from "../../utils/logger";
import { downscaleWorkerSource } from "./downscaleWorker";

/**
 * Shrinks one photograph for the life book — decode, box-filter to a longest
 * edge, re-encode as JPEG — in a small pool of worker threads, so a book with
 * hundreds of photographs never holds the server's event loop. Each image has a
 * deadline: a worker that runs past it (a slow or hostile file) is terminated
 * and replaced, and the image resolves to null.
 *
 * Null therefore means "this photo is not in the book": not a JPEG/PNG, over
 * the byte or pixel cap, undecodable, or timed out. The caller counts it as
 * skipped and says so; nothing here swallows a failure silently.
 */

export const MAX_DECODE_BYTES = 15 * 1024 * 1024;
export const MAX_DECODE_PIXELS = 30_000_000;
const POOL_SIZE = 2;
const IDLE_TERMINATE_MS = 30_000;
let timeoutMs = 30_000;

/** Test seam: the per-image deadline. */
export function setDownscaleTimeoutForTests(ms: number | null): void {
  timeoutMs = ms ?? 30_000;
}

interface Job {
  id: number;
  bytes: Uint8Array;
  mimetype: string;
  maxEdge: number;
  resolve: (data: Buffer | null) => void;
}

interface Slot {
  worker: Worker;
  job: Job | null;
  deadline: NodeJS.Timeout | null;
}

type Reply =
  { id: number; ok: true; bytes: Uint8Array | null } | { id: number; ok: false; message: string };

const queue: Job[] = [];
const slots: Slot[] = [];
let nextId = 1;
let idleTimer: NodeJS.Timeout | null = null;

function finish(slot: Slot, result: Buffer | null): void {
  const job = slot.job;
  slot.job = null;
  if (slot.deadline) clearTimeout(slot.deadline);
  slot.deadline = null;
  job?.resolve(result);
  pump();
}

function retire(slot: Slot, reason: string): void {
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
  void slot.worker.terminate();
  if (slot.job) logger.warn({ operation: "life_book_image_worker", reason });
  finish(slot, null);
}

function spawn(): Slot {
  const worker = new Worker(downscaleWorkerSource(), {
    eval: true,
    // A decode that balloons stays inside the worker.
    resourceLimits: { maxOldGenerationSizeMb: 768 },
  });
  worker.unref();
  const slot: Slot = { worker, job: null, deadline: null };
  worker.on("message", (reply: Reply) => {
    if (!slot.job || slot.job.id !== reply.id) return;
    if (reply.ok) finish(slot, reply.bytes ? Buffer.from(reply.bytes) : null);
    else {
      logger.warn({ operation: "life_book_image_undecodable", message: reply.message });
      finish(slot, null);
    }
  });
  worker.on("error", (err: unknown) =>
    retire(slot, err instanceof Error ? err.message : String(err))
  );
  worker.on("exit", () => {
    if (slots.includes(slot)) retire(slot, "worker exited");
  });
  slots.push(slot);
  return slot;
}

function dropIdle(): void {
  idleTimer = null;
  for (const slot of [...slots]) {
    if (!slot.job) {
      slots.splice(slots.indexOf(slot), 1);
      void slot.worker.terminate();
    }
  }
}

function pump(): void {
  while (queue.length > 0) {
    const slot = slots.find((s) => !s.job) ?? (slots.length < POOL_SIZE ? spawn() : null);
    if (!slot) return;
    const job = queue.shift() as Job;
    slot.job = job;
    slot.deadline = setTimeout(() => retire(slot, `timed out after ${timeoutMs} ms`), timeoutMs);
    slot.deadline.unref();
    slot.worker.postMessage({
      id: job.id,
      bytes: job.bytes,
      mimetype: job.mimetype,
      maxEdge: job.maxEdge,
      maxPixels: MAX_DECODE_PIXELS,
    });
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(dropIdle, IDLE_TERMINATE_MS);
  idleTimer.unref();
}

export function downscaleToJpeg(
  bytes: Buffer,
  mimetype: string,
  maxEdge: number
): Promise<{ data: Buffer; mimetype: "image/jpeg" } | null> {
  if (bytes.length === 0 || bytes.length > MAX_DECODE_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    queue.push({
      id: nextId++,
      bytes: new Uint8Array(bytes),
      mimetype,
      maxEdge,
      resolve: (data) => resolve(data ? { data, mimetype: "image/jpeg" } : null),
    });
    pump();
  });
}

/** Ends every worker now, for tests that must not leave a thread behind. */
export function shutdownDownscalePool(): void {
  for (const job of queue.splice(0)) job.resolve(null);
  for (const slot of [...slots]) {
    slots.splice(slots.indexOf(slot), 1);
    if (slot.deadline) clearTimeout(slot.deadline);
    slot.job?.resolve(null);
    void slot.worker.terminate();
  }
}

import { Worker } from "worker_threads";

import logger from "../../utils/logger";

/**
 * HEIC/HEIF → JPEG, off the request thread (forgejo#192).
 *
 * ## Why this decoder
 *
 * `sharp`'s prebuilt libvips links libheif WITHOUT an HEVC decoder (patents),
 * so it reads a HEIC's header and then refuses the pixels — measured on
 * 2026-10-04 with sharp 0.35.5: `metadata()` answers `heif / hevc / 4032×3024`,
 * `toBuffer()` fails with "Support for this compression format has not been
 * built in: HEVC". An iPhone photo is HEVC-coded, so sharp is no option, and
 * a system libheif would put a compiler-built native module into an image
 * that deliberately has none (see the Dockerfile's prod-deps stage).
 *
 * `heic-convert` decodes with `libheif-js` — libheif + libde265 compiled to
 * WebAssembly, no native code, no install script — and encodes with `jpeg-js`.
 * Measured on a 12-MP frame: 0.3 s decode + ~0.7 s encode for a typical
 * photo, 1.4 s + 1.4 s for a 9.9 MB worst case of pure noise, with the
 * process growing by ~200–400 MB while it runs.
 *
 * ## Why a worker, one at a time
 *
 * Both halves are synchronous CPU work. On the request thread a 20-photo
 * upload would freeze every other request of the instance for tens of
 * seconds. In ONE worker thread the API stays responsive, and conversions run
 * strictly one after another — a second concurrent decode would buy no
 * throughput (the worker is single-threaded) and double the peak memory.
 *
 * A WebAssembly heap grows and never shrinks, so the worker is terminated
 * after it has been idle a while; the next HEIC spawns a fresh one. A
 * conversion that runs past its deadline also takes the worker down — a
 * stuck decode must not hold the queue forever.
 */

/** A file the decoder could read but not turn into pixels — the client's file. */
export class HeicDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeicDecodeError";
  }
}

/** The converter itself failed (timeout, worker crash) — not the file's fault. */
export class HeicConverterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeicConverterUnavailableError";
  }
}

/** 0..1, jpeg-js's scale. 0.9 keeps a display copy close to the original. */
const JPEG_QUALITY = 0.9;
/** Generous against the 2.8 s worst case measured above; a hang, not a slow photo. */
const CONVERSION_TIMEOUT_MS = 60_000;
/** How long an idle worker (and its WebAssembly heap) is kept around. */
const IDLE_TERMINATE_MS = 30_000;

/**
 * The worker's whole program. Plain CommonJS evaluated in the worker, so it
 * runs the same under `tsx`, ts-jest and the compiled `dist/` — a `.ts`
 * worker file would need a loader in two of the three. The module path is
 * resolved here, in the main thread, so it never depends on the cwd.
 */
function workerSource(): string {
  const modulePath = require.resolve("heic-convert");
  return `
const { parentPort } = require("worker_threads");
const convert = require(${JSON.stringify(modulePath)});
parentPort.on("message", async (job) => {
  try {
    const out = await convert({ buffer: Buffer.from(job.bytes), format: "JPEG", quality: job.quality });
    parentPort.postMessage({ id: job.id, ok: true, bytes: new Uint8Array(out) });
  } catch (error) {
    parentPort.postMessage({ id: job.id, ok: false, message: String((error && error.message) || error) });
  }
});
`;
}

interface Job {
  id: number;
  bytes: Uint8Array;
  resolve: (jpeg: Buffer) => void;
  reject: (error: Error) => void;
}

type WorkerReply =
  { id: number; ok: true; bytes: Uint8Array } | { id: number; ok: false; message: string };

const queue: Job[] = [];
let active: Job | null = null;
let worker: Worker | null = null;
let deadline: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let nextId = 1;

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

function dropWorker(): void {
  const w = worker;
  worker = null;
  idleTimer = clearTimer(idleTimer);
  if (w) void w.terminate();
}

function settle(reply: WorkerReply): void {
  const job = active;
  if (!job || job.id !== reply.id) return;
  active = null;
  deadline = clearTimer(deadline);
  if (reply.ok) job.resolve(Buffer.from(reply.bytes));
  else job.reject(new HeicDecodeError(reply.message));
  pump();
}

/** The worker died under a job (crash, out of memory): fail that job, keep the queue going. */
function failActive(error: Error): void {
  const job = active;
  active = null;
  deadline = clearTimer(deadline);
  dropWorker();
  if (job) job.reject(error);
  pump();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerSource(), { eval: true });
  // Never keeps the process alive on its own — a test run or a shutdown must
  // not wait for an idle converter.
  w.unref();
  w.on("message", (reply: WorkerReply) => settle(reply));
  w.on("error", (error) => {
    logger.warn({
      operation: "heic_worker_error",
      message: "The HEIC converter worker failed",
      error: { message: error.message },
    });
    if (worker === w) failActive(new HeicConverterUnavailableError(error.message));
  });
  w.on("exit", (code) => {
    if (worker !== w) return;
    worker = null;
    if (active) failActive(new HeicConverterUnavailableError(`worker exited with ${code}`));
  });
  worker = w;
  return w;
}

function pump(): void {
  if (active) return;
  const job = queue.shift();
  if (!job) {
    idleTimer = clearTimer(idleTimer);
    idleTimer = setTimeout(dropWorker, IDLE_TERMINATE_MS);
    idleTimer.unref();
    return;
  }
  idleTimer = clearTimer(idleTimer);
  active = job;
  const w = ensureWorker();
  deadline = setTimeout(() => {
    logger.warn({
      operation: "heic_conversion_timeout",
      message: "A HEIC conversion ran past its deadline; the worker was replaced",
      context: { timeoutMs: CONVERSION_TIMEOUT_MS, bytes: job.bytes.byteLength },
    });
    failActive(new HeicConverterUnavailableError("conversion timed out"));
  }, CONVERSION_TIMEOUT_MS);
  deadline.unref();
  w.postMessage({ id: job.id, bytes: job.bytes, quality: JPEG_QUALITY });
}

/**
 * The JPEG rendition of a HEIC/HEIF file's primary image, rotation applied.
 *
 * Rejects with `HeicDecodeError` when the bytes are not a decodable HEIF
 * image, and with `HeicConverterUnavailableError` when the converter failed
 * for a reason that is not the file's.
 */
export function convertHeicToJpeg(bytes: Uint8Array): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    queue.push({ id: nextId++, bytes, resolve, reject });
    pump();
  });
}

/** Ends the worker now — for tests that must not leave a thread behind. */
export function shutdownHeicConverter(): void {
  for (const job of queue.splice(0)) {
    job.reject(new HeicConverterUnavailableError("converter shut down"));
  }
  if (active) failActive(new HeicConverterUnavailableError("converter shut down"));
  dropWorker();
}

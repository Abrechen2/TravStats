import { spawn } from "node:child_process";

import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";

/**
 * Reading a GPX file off the server's process (TravTrack plan E8, Codex
 * review P1).
 *
 * Validating and parsing a 23 MB file with 350,000 fixes took 2.6 s of
 * uninterrupted work and 356 MB of memory on the request thread — every other
 * request of the instance waited. So the file is read in a child process:
 *
 *   - with its own heap limit (`--max-old-space-size`): a file that would take
 *     more ends the child, not the server, and reads as unreadable. A child
 *     process rather than a worker thread because a worker's `resourceLimits`
 *     lose to an inherited `--max-old-space-size` (measured: with
 *     NODE_OPTIONS=--max-old-space-size=5120 a 4 MB limit let 100,000 fixes
 *     through); the child gets the server's environment minus NODE_OPTIONS;
 *   - with a point cap enforced while reading, before the tree is built (a
 *     count of `<trkpt`/`<rtept` in the text) and again while collecting;
 *   - one at a time on the instance, so two large files never stack their
 *     peaks; and with a deadline, so a stuck parse does not hold the queue.
 *
 * The document type declaration is refused in the child too, before the
 * parser sees the text (no entity expansion, no external entity).
 *
 * The child's program is plain CommonJS (`node -e`), so it runs the same
 * under tsx, ts-jest and the compiled `dist/`; the parser's module path is
 * resolved in the server. Bytes go in and typed arrays come back over IPC
 * with the structured-clone serialization.
 */

/** The most fixes one file may hold. */
export const GPX_IMPORT_MAX_POINTS = 200_000;
/**
 * The reader's old-generation heap, MB. Measured 2026-10-25: a 26.5 MB file
 * with 200,000 fixes (elevation, time, an extension each) parses in 384 MB and
 * not in 256; a lean 16 MB file of 200,000 fixes needs more than 128.
 */
export const GPX_WORKER_HEAP_MB = 384;
const GPX_WORKER_TIMEOUT_MS = 60_000;

/** What a file held, aligned per fix; NaN where it held no time or elevation. */
export type GpxFixes = {
  lon: Float64Array;
  lat: Float64Array;
  /** Epoch milliseconds, NaN without a time. */
  time: Float64Array;
  /** Metres, NaN without one. */
  ele: Float64Array;
  /** Where each recording segment starts. */
  segmentStarts: number[];
  /** Fixes whose position could not be read (missing or out of range). */
  invalid: number;
};

export type GpxWorkerOptions = {
  maxPoints?: number;
  heapMb?: number;
  timeoutMs?: number;
};

const unreadable = () =>
  new AppError("The file could not be read as GPX", 422, "TRAVTRACK_IMPORT_UNREADABLE");
const tooMany = (max: number) =>
  new AppError(
    `The file holds more than ${max} positions`,
    422,
    "TRAVTRACK_IMPORT_TOO_MANY_POINTS"
  );

function workerSource(): string {
  const parserPath = require.resolve("fast-xml-parser");
  return `
const { XMLParser, XMLValidator } = require(${JSON.stringify(parserPath)});

const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const isNode = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.trim()); return Number.isFinite(n) ? n : NaN; }
  return NaN;
};
const instant = (v) => (typeof v === "string" && v.trim() !== "" ? Date.parse(v) : NaN);

function main(job) {
  const max = job.maxPoints;
  const bytes = Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength);
  let xml = bytes.toString("utf8");
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (/<!\\s*(doctype|entity)/i.test(xml)) return { ok: false, code: "UNREADABLE" };
  // The cap before any tree is built: a plain count of the point tags.
  let tags = 0;
  for (const tag of ["<trkpt", "<rtept"]) {
    for (let i = xml.indexOf(tag); i !== -1; i = xml.indexOf(tag, i + tag.length)) {
      tags += 1;
      if (tags > max) return { ok: false, code: "TOO_MANY" };
    }
  }
  if (XMLValidator.validate(xml) !== true) return { ok: false, code: "UNREADABLE" };
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: true,
    trimValues: true,
  }).parse(xml);
  xml = null;
  const gpx = isNode(parsed) && isNode(parsed.gpx) ? parsed.gpx : null;
  if (!gpx) return { ok: false, code: "UNREADABLE" };

  const lon = [], lat = [], time = [], ele = [], starts = [];
  let invalid = 0;
  const take = (segmentNodes) => {
    const at = lon.length;
    for (const p of segmentNodes) {
      if (lon.length + invalid >= max) return false;
      const la = isNode(p) ? num(p["@_lat"]) : NaN;
      const lo = isNode(p) ? num(p["@_lon"]) : NaN;
      if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
        invalid += 1;
        continue;
      }
      lat.push(la); lon.push(lo); time.push(instant(p.time)); ele.push(num(p.ele));
    }
    if (lon.length > at) starts.push(at);
    return true;
  };
  const tracks = arr(gpx.trk).filter(isNode);
  if (tracks.length > 0) {
    for (const t of tracks) for (const s of arr(t.trkseg).filter(isNode)) {
      if (!take(arr(s.trkpt))) return { ok: false, code: "TOO_MANY" };
    }
  } else {
    for (const r of arr(gpx.rte).filter(isNode)) {
      if (!take(arr(r.rtept))) return { ok: false, code: "TOO_MANY" };
    }
  }
  if (lon.length === 0) return { ok: false, code: "UNREADABLE" };
  return {
    ok: true,
    lon: Float64Array.from(lon), lat: Float64Array.from(lat),
    time: Float64Array.from(time), ele: Float64Array.from(ele),
    segmentStarts: starts, invalid,
  };
}

process.once("message", (job) => {
  let reply;
  try { reply = main(job); } catch (e) { reply = { ok: false, code: "UNREADABLE" }; }
  process.send(reply, () => process.exit(0));
});
`;
}

type Reply = { ok: false; code: "UNREADABLE" | "TOO_MANY" } | ({ ok: true } & GpxFixes);

/** The child's environment: the server's, minus flags that would override its heap limit. */
function childEnv(): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _flags, ...env } = process.env;
  return env;
}

function runWorker(buffer: Buffer, opts: Required<GpxWorkerOptions>): Promise<GpxFixes> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${opts.heapMb}`, "-e", workerSource()],
      { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", env: childEnv() }
    );
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      fn();
    };
    const deadline = setTimeout(() => done(() => reject(unreadable())), opts.timeoutMs);
    child.on("message", (reply: Reply) =>
      done(() => {
        if (reply.ok) {
          const { ok: _ok, ...fixes } = reply;
          resolve(fixes);
        } else reject(reply.code === "TOO_MANY" ? tooMany(opts.maxPoints) : unreadable());
      })
    );
    // Out of memory (the child aborts), a crash, a failed start: the file's, not the server's.
    const failed = (why: string) =>
      done(() => {
        logger.warn({ operation: "travtrack.import.reader_failed", why });
        reject(unreadable());
      });
    child.on("error", (err) => failed(err.message));
    child.on("exit", (code, signal) => failed(`exit ${code ?? signal}`));
    child.send({ bytes: new Uint8Array(buffer), maxPoints: opts.maxPoints }, (err) => {
      if (err) failed(err.message);
    });
  });
}

let queue: Promise<unknown> = Promise.resolve();

/** Reads the file in a worker, one file at a time on the instance. */
export function parseGpxInWorker(buffer: Buffer, opts: GpxWorkerOptions = {}): Promise<GpxFixes> {
  const full: Required<GpxWorkerOptions> = {
    maxPoints: opts.maxPoints ?? GPX_IMPORT_MAX_POINTS,
    heapMb: opts.heapMb ?? GPX_WORKER_HEAP_MB,
    timeoutMs: opts.timeoutMs ?? GPX_WORKER_TIMEOUT_MS,
  };
  const run = queue.then(() => runWorker(buffer, full));
  queue = run.catch(() => undefined);
  return run;
}

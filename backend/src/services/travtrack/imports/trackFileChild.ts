import { spawn } from "node:child_process";

import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";

/**
 * Runs a track-file reader (Google Timeline JSON, KML, TCX) in a child
 * process, the way `gpxWorker.ts` runs the GPX reader and for the same reasons
 * (TravTrack plan E8, forgejo#394): a file of hundreds of megabytes must cost
 * the child its time and memory, not the server's event loop.
 *
 *   - its own heap limit (`--max-old-space-size`); a file that needs more ends
 *     the child and reads as unreadable;
 *   - NODE_OPTIONS stripped, so an inherited heap flag cannot override it;
 *   - one reader at a time on the instance, and a deadline, so a stuck parse
 *     does not hold the queue;
 *   - the child's program is plain CommonJS (`node -e`), so it runs the same
 *     under tsx, ts-jest and the compiled `dist/`.
 *
 * Protocol: the parent sends one `{ bytes, ...job }`; the child answers with
 * any number of `{ type: "progress", done, total }` and one
 * `{ type: "result", ... }` or `{ type: "error", code }`.
 */

export type ChildLimits = { heapMb: number; timeoutMs: number };

export type ChildErrorCode = "UNREADABLE" | "TOO_MANY";

type ChildReply<R> =
  | { type: "progress"; done: number; total: number }
  | ({ type: "result" } & R)
  | { type: "error"; code: ChildErrorCode };

export const unreadable = (format: string) =>
  new AppError(`The file could not be read as ${format}`, 422, "TRAVTRACK_IMPORT_UNREADABLE");

export const tooMany = (max: number) =>
  new AppError(
    `The file holds more than ${max} positions`,
    422,
    "TRAVTRACK_IMPORT_TOO_MANY_POINTS"
  );

/** The child's environment: the server's, minus flags that would override its heap limit. */
function childEnv(): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _flags, ...env } = process.env;
  return env;
}

let queue: Promise<unknown> = Promise.resolve();

function run<R>(
  source: string,
  buffer: Buffer,
  job: Record<string, unknown>,
  limits: ChildLimits,
  maxPoints: number,
  format: string,
  onProgress?: (done: number, total: number) => void
): Promise<R> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${limits.heapMb}`, "-e", source], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
      env: childEnv(),
    });
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      fn();
    };
    const deadline = setTimeout(() => done(() => reject(unreadable(format))), limits.timeoutMs);
    child.on("message", (reply: ChildReply<R>) => {
      if (reply.type === "progress") {
        onProgress?.(reply.done, reply.total);
        return;
      }
      done(() => {
        if (reply.type === "result") {
          const { type: _type, ...rest } = reply;
          resolve(rest as unknown as R);
        } else reject(reply.code === "TOO_MANY" ? tooMany(maxPoints) : unreadable(format));
      });
    });
    // Out of memory (the child aborts), a crash, a failed start: the file's, not the server's.
    const failed = (why: string) =>
      done(() => {
        logger.warn({ operation: "travtrack.import.reader_failed", why });
        reject(unreadable(format));
      });
    child.on("error", (err) => failed(err.message));
    child.on("exit", (code, signal) => failed(`exit ${code ?? signal}`));
    child.send({ ...job, bytes: new Uint8Array(buffer), maxPoints }, (err) => {
      if (err) failed(err.message);
    });
  });
}

/** Runs one reader in a child, one at a time on the instance. */
export function runInChild<R>(args: {
  source: string;
  buffer: Buffer;
  job: Record<string, unknown>;
  limits: ChildLimits;
  maxPoints: number;
  /** What the file is, for the refusal's wording. */
  format: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<R> {
  const next = queue.then(() =>
    run<R>(
      args.source,
      args.buffer,
      args.job,
      args.limits,
      args.maxPoints,
      args.format,
      args.onProgress
    )
  );
  queue = next.catch(() => undefined);
  return next;
}

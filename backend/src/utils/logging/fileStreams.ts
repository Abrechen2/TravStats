import fs from "fs";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import { LOGGING_DEFAULTS } from "../../config/constants";
import { getLogDir, rotatedFileNameGenerator } from "./logFiles";

/**
 * ONE rotating stream per physical log file, shared by every logger that
 * writes to it.
 *
 * Until 2026-09-26 each category logger opened its own `app.log` and
 * `error.log` streams — eighteen rotating-file-stream instances on the same
 * two files, each rotating on its own clock. The result on the beta: double
 * rotations, `.gz` files no stream's history knew about, and 69 files going
 * back five months under a seven-day retention setting.
 *
 * Rotation is all these streams do. Deleting old files is the retention
 * sweep's job alone (`services/logRetention.ts`), which is why no `maxFiles`
 * is passed here: two deleters with two policies is the bug being removed.
 */

const streams = new Map<string, RotatingFileStream>();
let rotationSizeMb: number = LOGGING_DEFAULTS.MAX_LOG_FILE_SIZE_MB;

/** Warnings go to stderr: the logger cannot report that it cannot write. */
function warn(message: string): void {
  process.stderr.write(`[logger] ${message}\n`);
}

function ensureLogDir(): boolean {
  const dir = getLogDir();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (error) {
    warn(`log directory ${dir} is not writable (${(error as Error).message}); console only`);
    return false;
  }
}

/**
 * The shared stream for `<name>.log`, opened on first use. Null when the log
 * directory cannot be written — the logger then keeps the console only.
 */
export function getFileStream(name: string): RotatingFileStream | null {
  const existing = streams.get(name);
  if (existing) return existing;
  if (!ensureLogDir()) return null;

  try {
    const stream = createStream(rotatedFileNameGenerator(name), {
      path: getLogDir(),
      size: `${rotationSizeMb}M`,
      interval: "1d",
      compress: "gzip",
    });
    stream.on("error", (error: NodeJS.ErrnoException) => {
      warn(`cannot write ${name}.log (${error.code ?? error.message}); dropping the stream`);
      streams.delete(name);
    });
    streams.set(name, stream);
    return stream;
  } catch (error) {
    warn(`cannot open ${name}.log (${(error as Error).message}); console only`);
    return null;
  }
}

/** Names (`app`, `security`, …) of the files a live stream is writing. */
export function openStreamNames(): ReadonlySet<string> {
  return new Set(streams.keys());
}

/**
 * The rotation size applies to streams opened from now on. rotating-file-stream
 * cannot change the size of an open stream, and closing app.log under a
 * running logger would lose lines, so a changed size takes effect at restart
 * for the two base files and at the next enable for category files.
 */
export function setRotationSizeMb(sizeMb: number): void {
  if (Number.isFinite(sizeMb) && sizeMb > 0) rotationSizeMb = sizeMb;
}

/** Close one stream (a category file that was switched off). */
export function closeFileStream(name: string): void {
  const stream = streams.get(name);
  if (!stream) return;
  streams.delete(name);
  stream.end();
}

/** Close everything and wait — for tests and shutdown. */
export async function closeAllFileStreams(): Promise<void> {
  const all = [...streams.values()];
  streams.clear();
  await Promise.all(
    all.map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.once("finish", () => resolve());
          stream.once("error", () => resolve());
          stream.end();
        })
    )
  );
}

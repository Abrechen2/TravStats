import path from "path";

/**
 * Where the log files live and how their names are read — one home for both.
 *
 * The directory used to be computed twice (logger and log manager) and the
 * name parsing three times, each with its own idea of a rotated file.
 */

/**
 * `TRAVSTATS_LOG_DIR` exists for tests, which need a directory of their own;
 * production uses the data volume next to the backend.
 *
 * Evaluated on each call, not at import, so a test can point it elsewhere.
 */
export function getLogDir(): string {
  return process.env.TRAVSTATS_LOG_DIR || path.join(process.cwd(), "..", "data", "logs");
}

/** Only these characters ever reach the filesystem — the traversal guard. */
const SAFE_NAME = /^[a-zA-Z0-9\-.]+\.log(\.gz)?$/;

export function isSafeLogFileName(filename: string): boolean {
  return SAFE_NAME.test(filename) && !filename.includes("..");
}

export interface ParsedLogFileName {
  /** `app`, `error`, `security`, `parser-text`, … */
  stream: string;
  /** A rotated copy rather than the file being written to. */
  rotated: boolean;
  compressed: boolean;
}

// Rotated names this code writes: `app-20260926-0000-01.log.gz`.
const ROTATED_OWN = /^([a-z][a-z-]*?)-\d{8}-\d{4}-\d+\.log(\.gz)?$/;
// rotating-file-stream's default, which every file before 2026-09-26 carries:
// `20260926-0000-01-app.log.gz`.
const ROTATED_LEGACY = /^\d{8}-\d{4}-\d+-([a-z][a-z-]*)\.log(\.gz)?$/;
const ACTIVE = /^([a-z][a-z-]*)\.log$/;

/** Null for anything that is not one of our log files. */
export function parseLogFileName(filename: string): ParsedLogFileName | null {
  const active = ACTIVE.exec(filename);
  if (active) return { stream: active[1], rotated: false, compressed: false };
  const own = ROTATED_OWN.exec(filename) ?? ROTATED_LEGACY.exec(filename);
  if (own) return { stream: own[1], rotated: true, compressed: Boolean(own[2]) };
  return null;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * rotating-file-stream's name generator: `null` asks for the live file,
 * a time for a rotated one. The stream name comes FIRST so a listing groups
 * a stream's files together and `parseLogFileName` reads it without guessing.
 * rotating-file-stream appends `.gz` itself.
 */
export function rotatedFileNameGenerator(stream: string) {
  return (time: Date | number | null, index?: number): string => {
    if (!time) return `${stream}.log`;
    const t = typeof time === "number" ? new Date(time) : time;
    const stamp =
      `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
      `-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
    return `${stream}-${stamp}-${pad(index ?? 1)}.log`;
  };
}

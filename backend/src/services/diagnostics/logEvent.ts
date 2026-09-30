import { DiagnosticLogEvent, LogFileEntry } from "../../shared/logContract";

/**
 * Reduce a log line to what a public bug report may carry.
 *
 * The old export copied each line and scrubbed a NEGATIVE list (IPs, emails,
 * JWTs, UUIDs). A real export still carried the hostname and pid, Windows
 * paths, full query strings with names and PNRs, a mistyped login username
 * and a new account's name — everything the list had not thought of.
 *
 * This keeps a POSITIVE list of fields, each checked against a shape that
 * cannot hold free text:
 *  - `time`, `level`;
 *  - `category` and `event` only when they look like code-defined keys
 *    (`snake_case`), never prose — the event is the line's `operation`, or its
 *    message when that message is itself a key of three or more segments;
 *  - an error's `code` (`P2002`, `ENOENT`, `RATE_LIMITED`) and class name;
 *  - stack frames reduced to `file.ts:123` — basename and line, no directory,
 *    no function name, no column.
 * Messages, context objects, URLs, request data and values are dropped whole.
 */

const KEY = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+){0,12}$/;
/** A message only counts as a key when it cannot be a single word or a name. */
const MESSAGE_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){2,12}$/;
const ERROR_CODE = /^(?:[A-Z][A-Z0-9_]{1,39}|P\d{4})$/;
const ERROR_NAME = /^[A-Z][A-Za-z0-9]{0,59}$/;
const LEVEL = /^(?:trace|debug|info|warn|error|fatal)$/;
const FRAME = /([^\\/():\s]+\.(?:ts|js|mjs|cjs|tsx)):(\d+)(?::\d+)?\)?\s*$/;
const MAX_FRAMES = 10;

function keyOrNull(value: unknown, pattern: RegExp = KEY): string | null {
  return typeof value === "string" && value.length <= 80 && pattern.test(value) ? value : null;
}

function stackFrames(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    if (!/^\s*at\s/.test(line)) continue;
    const match = FRAME.exec(line);
    if (match) frames.push(`${match[1]}:${match[2]}`);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function errorOf(entry: LogFileEntry): Record<string, unknown> | null {
  const candidate = entry.error ?? entry.err;
  return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
}

export function toDiagnosticLogEvent(entry: LogFileEntry): DiagnosticLogEvent | null {
  const rawTime = entry.timestamp ?? entry.time;
  const time = typeof rawTime === "string" ? Date.parse(rawTime) : NaN;
  if (!Number.isFinite(time)) return null;

  const error = errorOf(entry);
  const code = error?.code;
  return {
    time: new Date(time).toISOString(),
    level: typeof entry.level === "string" && LEVEL.test(entry.level) ? entry.level : "unknown",
    category: keyOrNull(entry.category),
    event: keyOrNull(entry.operation) ?? keyOrNull(entry.message, MESSAGE_KEY),
    errorCode: typeof code === "string" && ERROR_CODE.test(code) ? code : null,
    errorName: keyOrNull(error?.name ?? error?.type, ERROR_NAME),
    stack: stackFrames(error?.stack),
  };
}

export function toDiagnosticLogEvents(entries: LogFileEntry[]): DiagnosticLogEvent[] {
  return entries
    .map(toDiagnosticLogEvent)
    .filter((event): event is DiagnosticLogEvent => event !== null);
}

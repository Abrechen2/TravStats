/**
 * How a long TravTrack import shares the database with everybody else
 * (2026-11-24, a 45 MB Google Timeline on prod): batches are small and each
 * commits on its own, the job pauses after every batch in proportion to what
 * the batch cost, and a batch that could not get the account's lock in time is
 * retried later instead of holding a transaction open. The same pacing is
 * used between the days of the derivation backlog.
 *
 * Modelled on Dawarich (`app/services/google_maps/records_importer.rb`:
 * `BATCH_SIZE = 1000`, one bulk insert per slice, on its own `imports` queue).
 */

/** The shortest pause after a batch: web requests always get a turn. */
export const PACE_MIN_MS = 50;
/** The longest: a slow disk must not stretch an import into hours. */
export const PACE_MAX_MS = 5_000;
/** The pause is the batch's own duration times this. */
export const PACE_FACTOR = 1;

/** The pause after a piece of work that took `durationMs`: as long again, within the bounds. */
export function paceAfter(
  durationMs: number,
  opts: { factor?: number; minMs?: number; maxMs?: number } = {}
): number {
  const factor = opts.factor ?? PACE_FACTOR;
  const min = opts.minMs ?? PACE_MIN_MS;
  const max = opts.maxMs ?? PACE_MAX_MS;
  const wanted = Number.isFinite(durationMs) && durationMs > 0 ? durationMs * factor : 0;
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A pacer for a loop: `await pace(async () => work())` runs the work, then
 * sleeps in proportion to its duration.
 */
export function adaptivePacer(
  wait: Sleep = sleep,
  now: () => number = () => performance.now()
): <T>(work: () => Promise<T>) => Promise<T> {
  return async (work) => {
    const started = now();
    const out = await work();
    await wait(paceAfter(now() - started));
    return out;
  };
}

/** Postgres codes of a wait that gave up: lock timeout, statement timeout, deadlock, serialization. */
const TRANSIENT_PG = new Set(["55P03", "57014", "40P01", "40001"]);
/** Prisma's: an interactive transaction that expired, a write conflict or deadlock. */
const TRANSIENT_PRISMA = new Set(["P2028", "P2034"]);

/** Whether a batch failed only because the database was busy: worth another try later. */
export function isTransientDbError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as {
    code?: unknown;
    meta?: { code?: unknown };
    cause?: unknown;
    originalCode?: unknown;
    message?: unknown;
  };
  const codes = [e.code, e.meta?.code, e.originalCode].filter((c) => typeof c === "string");
  if (codes.some((c) => TRANSIENT_PG.has(c as string) || TRANSIENT_PRISMA.has(c as string))) {
    return true;
  }
  if (typeof e.message === "string" && /lock timeout|statement timeout/i.test(e.message)) {
    return true;
  }
  return isTransientDbError(e.cause, depth + 1);
}

export type ImportEndStatus = "succeeded" | "partial" | "failed";

/**
 * How a file import ends: every point handled is `succeeded`; stopped with
 * any batch committed is `partial` (resumable from its cursor); `failed` only
 * when nothing could be stored.
 */
export function importEndStatus(end: {
  completed: boolean;
  cursor: number;
  stored: number;
}): ImportEndStatus {
  if (end.completed) return "succeeded";
  return end.cursor > 0 || end.stored > 0 ? "partial" : "failed";
}

/** Runs one piece of a loop's work and pauses after it (`adaptivePacer`), or not at all. */
export type Pace = <T>(work: () => Promise<T>) => Promise<T>;

/** No pause: a test, or a caller that paces itself. */
export const noPace: Pace = (work) => work();

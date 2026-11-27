import axios from "axios";

/**
 * The bulk link runs one request per trip pair, one after the other, so a person with sixty trips
 * neither floods the server nor another one. A rate-limit answer (429) is not a failure: the run
 * pauses for the server's `Retry-After` and carries on with the same pair (UAT 2026-11-27).
 */

/** The pause between two calls of a run. */
export const BULK_PACE_MS = 250;
/** A 429 without a usable `Retry-After`: wait this long. */
const DEFAULT_RETRY_MS = 60_000;
/** Never wait longer than an hour (the limit's window). */
const MAX_RETRY_MS = 60 * 60_000;

/** How long to pause after this error, or null when it is not a rate limit. */
export function retryAfterMs(err: unknown): number | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 429) return null;
  const raw = Number(err.response.headers?.["retry-after"]);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETRY_MS;
  return Math.min(raw * 1000, MAX_RETRY_MS);
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `step` and, while the server answers 429, tell `onPause` the minutes left and try again —
 * unless `stopped()` says the person stopped the run meanwhile (then it rethrows nothing and
 * answers `"stopped"`).
 */
export async function withRateLimitPause<T>(
  step: () => Promise<T>,
  onPause: (minutes: number | null) => void,
  stopped: () => boolean
): Promise<T | "stopped"> {
  for (;;) {
    try {
      const out = await step();
      onPause(null);
      return out;
    } catch (err) {
      const ms = retryAfterMs(err);
      if (ms === null) throw err;
      onPause(Math.max(1, Math.ceil(ms / 60_000)));
      await wait(ms);
      if (stopped()) return "stopped";
    }
  }
}

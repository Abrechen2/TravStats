/**
 * Per-member limits of remote plan calls (spec 2026-11-02 §4: 120 writes and 600 reads a minute,
 * moved over from the guest door unchanged). Keyed by the member, so one person cannot spend
 * another's allowance and changing the peer's address buys nothing. In-process, like the other
 * limiters of a single-instance server.
 */
import { REMOTE_READS_PER_MINUTE, REMOTE_WRITES_PER_MINUTE } from "./shared";

const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

/** Count one call; false when the member's allowance for the minute is spent. */
export function takeRemoteCall(memberId: string, write: boolean, now = Date.now()): boolean {
  const key = `${write ? "w" : "r"}:${memberId}`;
  const limit = write ? REMOTE_WRITES_PER_MINUTE : REMOTE_READS_PER_MINUTE;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}

export function resetRemoteCalls(): void {
  hits.clear();
}

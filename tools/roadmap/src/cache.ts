import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CollectorResult } from "./types.js";

export interface CachedSection<T> {
  readonly data: T;
  readonly collectedAt: string;
}

export interface Resolved<T> {
  /** Null means: we have nothing. The renderer must say so, not render empty. */
  readonly data: T | null;
  /** Non-null means the data is from the cache, collected at this timestamp. */
  readonly staleSince: string | null;
  readonly reason: string | null;
}

/**
 * Prefers fresh data; falls back to the cache and MARKS it. The one thing this
 * must never do is present cached data as if it were live — an unmarked stale
 * version tag would send someone deploying against the wrong assumption.
 */
export function withFallback<T>(
  result: CollectorResult<T>,
  cached: CachedSection<T> | undefined,
  _now: Date
): Resolved<T> {
  if (result.ok) return { data: result.data, staleSince: null, reason: null };
  if (cached) return { data: cached.data, staleSince: cached.collectedAt, reason: result.reason };
  return { data: null, staleSince: null, reason: result.reason };
}

export async function readCache(path: string): Promise<Record<string, CachedSection<unknown>>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof raw === "object" && raw !== null
      ? (raw as Record<string, CachedSection<unknown>>)
      : {};
  } catch {
    return {};
  }
}

export async function writeCache(
  path: string,
  snapshot: Record<string, CachedSection<unknown>>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2), "utf8");
}

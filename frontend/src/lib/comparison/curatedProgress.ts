/** Curated-list progress of one row: "visited of size", from the two totals the snapshot carries. */
import { CURATED_LIST_METRICS, curatedSizeKey } from "../../shared/comparisonMetrics";
import type { LeaderboardRow } from "./types";

export interface CuratedProgress {
  visited: number;
  size: number;
}

/** null when the row did not answer, the figure is absent or null, or the size is unknown. */
export function curatedProgress(
  row: LeaderboardRow | undefined,
  metricKey: string,
  year: number | null
): CuratedProgress | null {
  if (!row || row.status !== "ok" || !row.snapshot || row.snapshot.year !== year) return null;
  const visited = row.snapshot.metrics[metricKey];
  const size = row.snapshot.metrics[curatedSizeKey(metricKey)];
  if (typeof visited !== "number" || typeof size !== "number" || size <= 0) return null;
  return { visited: Math.min(visited, size), size };
}

export const CURATED_KEYS: readonly string[] = CURATED_LIST_METRICS.map((m) => m.key);

/** "Norbert has seen 18 more" — only between two real answers; null otherwise. */
export function curatedLead(
  mine: CuratedProgress | null,
  theirs: CuratedProgress | null
): { ahead: "you" | "them"; gap: number } | null {
  if (!mine || !theirs || mine.visited === theirs.visited) return null;
  return {
    ahead: mine.visited > theirs.visited ? "you" : "them",
    gap: Math.abs(mine.visited - theirs.visited),
  };
}

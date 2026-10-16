/**
 * Like-for-like ranking (spec §8). A value ranks only when the row answered, for the year asked,
 * with a number; cross-domain figures only between equal domain sets. Withheld or unknown never
 * becomes 0. A lower bound ranks — it is true as far as it goes — and is marked partial.
 */
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import type { LeaderboardRow, RowStatus } from "./types";

export type UnrankedReason =
  Exclude<RowStatus, "ok"> | "metricNotShared" | "unknown" | "otherYear" | "notComparable";

export interface RankedEntry {
  row: LeaderboardRow;
  value: number | null;
  rank: number | null;
  partial: boolean;
  reason: UnrankedReason | null;
}

const CROSS_DOMAIN: ReadonlySet<string> = new Set(
  LEADERBOARD_METRICS.filter((m) => m.domain === null).map((m) => m.key)
);
const domainSet = (domains: readonly string[]) => [...domains].sort().join(",");

function judge(
  row: LeaderboardRow,
  metric: MetricKey,
  year: number | null,
  selfDomains: string | null
): { value: number | null; reason: UnrankedReason | null } {
  if (row.status !== "ok") return { value: null, reason: row.status };
  const snapshot = row.snapshot;
  if (!snapshot) return { value: null, reason: "unknown" };
  if (snapshot.year !== year) return { value: null, reason: "otherYear" };
  if (!Object.prototype.hasOwnProperty.call(snapshot.metrics, metric))
    return { value: null, reason: "metricNotShared" };
  const value = snapshot.metrics[metric];
  if (typeof value !== "number") return { value: null, reason: "unknown" };
  if (
    CROSS_DOMAIN.has(metric) &&
    selfDomains !== null &&
    domainSet(snapshot.domains) !== selfDomains
  )
    return { value: null, reason: "notComparable" };
  return { value, reason: null };
}

export function rankPeople(
  rows: readonly LeaderboardRow[],
  metric: MetricKey,
  year: number | null
): RankedEntry[] {
  const self = rows.find((r) => r.person.kind === "self");
  const selfDomains = self?.snapshot ? domainSet(self.snapshot.domains) : null;
  const entries = rows.map((row) => ({
    row,
    ...judge(row, metric, year, selfDomains),
    partial: row.snapshot?.partial.includes(metric) ?? false,
  }));
  const sorted = [...entries].sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value !== null) return -1;
      if (b.value !== null) return 1;
      return a.row.person.displayName.localeCompare(b.row.person.displayName);
    }
    return b.value - a.value || a.row.person.displayName.localeCompare(b.row.person.displayName);
  });
  let last: number | null = null;
  let rank = 0;
  return sorted.map((entry, index) => {
    if (entry.value !== null && entry.value !== last) rank = index + 1;
    if (entry.value !== null) last = entry.value;
    return { ...entry, rank: entry.value === null ? null : rank };
  });
}

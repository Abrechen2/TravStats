import type { Snapshot } from "../../lib/api/comparison";
export type Metric = keyof Snapshot["metrics"];
export interface ComparisonRow {
  id: string;
  label: string;
  snapshot: Snapshot | null;
  error?: boolean;
}
/** Only like-for-like observations rank. Withheld/partial/rounded rows never become zero. */
export function rankRows(
  rows: ComparisonRow[],
  metric: Metric,
  year: number | null,
  currency?: string
) {
  const reference =
    rows.find((r) => r.id === "self")?.snapshot ?? rows.find((r) => r.snapshot)?.snapshot;
  const domainSet = (s: Snapshot | null | undefined) => [...(s?.domains ?? [])].sort().join(",");
  const comparable = (r: ComparisonRow) =>
    r.snapshot?.year === year &&
    r.snapshot.coverage === "all" &&
    r.snapshot.precision === "exact" &&
    r.snapshot.definition === "travstats-comparison-1" &&
    (metric !== "cost" || r.snapshot.currency === currency) &&
    (!["countries", "daysAway"].includes(metric) || domainSet(r.snapshot) === domainSet(reference));
  const sorted = [...rows].sort((a, b) => {
    const av = comparable(a) ? (a.snapshot?.metrics[metric] ?? null) : null,
      bv = comparable(b) ? (b.snapshot?.metrics[metric] ?? null) : null;
    return av === null
      ? bv === null
        ? a.label.localeCompare(b.label)
        : 1
      : bv === null
        ? -1
        : bv - av;
  });
  let last: number | null = null,
    rank = 0;
  return sorted.map((row, index) => {
    const value = comparable(row) ? (row.snapshot?.metrics[metric] ?? null) : null;
    if (value !== null && value !== last) rank = index + 1;
    last = value;
    return { ...row, rank: value === null ? null : rank };
  });
}

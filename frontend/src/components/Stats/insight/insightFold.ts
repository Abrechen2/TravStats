import type { LodgingInsights, MeasureTotals } from "../../../types/statsInsights";

/**
 * The year slice of a server total: lifetime when no year is chosen, that
 * year's own figure otherwise — 0 only when the server says the year holds
 * nothing (it omits such a year, and an omitted year IS an empty one here,
 * because the series covers every record that has a year).
 */
export function totalFor(totals: MeasureTotals, key: string, year: number | null): number {
  const total = totals[key];
  if (!total) return 0;
  return year === null ? total.allTime : (total.byYear[String(year)] ?? 0);
}

/** Median of a list, or null for an empty one — never 0 for "no trips". */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nights per house type for the period, largest first, and their total. */
export function foldSleepStyle(
  data: LodgingInsights,
  year: number | null
): { rows: Array<[string, number]>; total: number } {
  const byType = new Map<string, number>();
  for (const y of data.sleepStyle.byYear) {
    if (year !== null && y.year !== year) continue;
    for (const [type, nights] of Object.entries(y.nightsByType)) {
      byType.set(type, (byType.get(type) ?? 0) + nights);
    }
  }
  const rows = [...byType.entries()].sort(([, a], [, b]) => b - a);
  return { rows, total: rows.reduce((s, [, n]) => s + n, 0) };
}

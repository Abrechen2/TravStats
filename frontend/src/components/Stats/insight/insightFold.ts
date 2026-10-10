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

type Translate = (key: string, values?: Record<string, unknown>) => string;

/**
 * A duration to the minute: "25 Min.", "3 Std.", "1 Std. 30 Min." — the units
 * are copy (`stats:insight.duration.*`), the numbers go through the page's own
 * number format. Never rounded to whole hours, where a 25-minute walk read as
 * "0" and three and a half hours as "4".
 */
export function formatDuration(seconds: number, t: Translate, nf: Intl.NumberFormat): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return t("stats:insight.duration.minutes", { m: nf.format(m) });
  if (m === 0) return t("stats:insight.duration.hours", { h: nf.format(h) });
  return t("stats:insight.duration.hoursMinutes", { h: nf.format(h), m: nf.format(m) });
}

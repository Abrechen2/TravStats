import { now as clockNow } from "../../../shared/time/clock";
import { loadDistanceEntries } from "./loadEntries";

export interface YearCount {
  year: number;
  total: number;
  byDomain: Record<string, number>;
}

/**
 * `GET /stats/years/counts` — entries per year and domain. It folds the very entries
 * `/stats/years` measures (each domain's own counting rule, each filed on its own calendar), so a
 * year's caption in the picker can never disagree with the card of that year about what counts.
 * Newest year first.
 */
export async function loadYearCounts(userId: string): Promise<{ years: YearCount[] }> {
  const entries = await loadDistanceEntries(userId, clockNow());
  const byYear = new Map<number, YearCount>();
  for (const entry of entries) {
    const year = Number(entry.month.slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const row = byYear.get(year) ?? { year, total: 0, byDomain: {} };
    row.total += 1;
    row.byDomain[entry.domain] = (row.byDomain[entry.domain] ?? 0) + 1;
    byYear.set(year, row);
  }
  return { years: [...byYear.values()].sort((a, b) => b.year - a.year) };
}

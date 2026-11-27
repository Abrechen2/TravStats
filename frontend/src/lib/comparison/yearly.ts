/**
 * Yearly totals of one row (snapshot v3, opt-in): a series per metric for the head-to-head
 * sparklines. A year the sender did not list has no recorded activity (the server omits a year
 * whose figures are all zero or unknown), so inside the shown range it is a 0; a year whose own
 * figure is null stays a gap — unknown is never drawn as zero.
 */
import type { LeaderboardRow } from "./types";

export interface YearPoint {
  year: number;
  value: number | null;
}

/** The sender's yearly totals, or null when the row did not answer, is an older peer, or did not opt in. */
export function yearlyOf(
  row: LeaderboardRow | undefined
): Record<string, Record<string, number | null>> | null {
  if (!row || row.status !== "ok" || !row.snapshot || row.snapshot.year !== null) return null;
  const years = row.snapshot.years;
  return years && Object.keys(years).length > 0 ? years : null;
}

/** Both people's series over the same, contiguous span of years; null when there is no span of two. */
export function seriesPair(
  mine: ReturnType<typeof yearlyOf>,
  theirs: ReturnType<typeof yearlyOf>,
  metric: string
): { mine: YearPoint[]; theirs: YearPoint[] } | null {
  if (!mine || !theirs) return null;
  const years = [...Object.keys(mine), ...Object.keys(theirs)].map(Number);
  const from = Math.min(...years);
  const to = Math.max(...years);
  if (to - from < 1) return null;
  const build = (src: NonNullable<ReturnType<typeof yearlyOf>>): YearPoint[] =>
    Array.from({ length: to - from + 1 }, (_, i) => {
      const year = from + i;
      const figures = src[String(year)];
      if (!figures) return { year, value: 0 };
      const v = figures[metric];
      return { year, value: typeof v === "number" ? v : v === null ? null : 0 };
    });
  const result = { mine: build(mine), theirs: build(theirs) };
  const hasData = (p: YearPoint[]): boolean => p.some((x) => x.value !== null && x.value > 0);
  return hasData(result.mine) || hasData(result.theirs) ? result : null;
}

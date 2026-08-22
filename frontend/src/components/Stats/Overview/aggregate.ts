// Pure aggregation helpers for the cross-domain overview. Take a
// DomainStatsMap + a DomainKey filter set, fold into the year-scoped
// shape the KPI / chart / heatmap components consume.
import type { DomainKey } from "../../../shared/domains";
import type { DomainStats, DomainStatsMap, YearScopedAgg } from "../../../lib/stats/domain-stats";

export interface DeltaInfo {
  diff: number;
  pct: number | null;
  sign: "up" | "down" | "flat";
}

export function delta(current: number, previous: number | null | undefined): DeltaInfo | null {
  if (previous === undefined || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null;
  return { diff, pct, sign: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

/**
 * Aggregate visible domains for the requested year — or lifetime when
 * `year === null`. Two different counting semantics are at play:
 *  - `totalEvents` / `yearlyEvents`: count the *event* once, in the
 *    year it started. A cruise that spans 2023-12-30 → 2024-01-02
 *    contributes 1 to year 2023 only — the trip is one event, the
 *    "year I cruised" is the year it began.
 *  - `activeDays` / `yearlyActiveDays`: count *days*, expanded across
 *    the actual calendar. The same cruise contributes 2 to 2023 and
 *    2 to 2024 (Dec 30+31, Jan 01+02). This is what makes the
 *    heatmap honest for span-events.
 */
export function aggregate(
  statsMap: DomainStatsMap,
  visible: Partial<Record<DomainKey, boolean>>,
  year: number | null
): YearScopedAgg {
  const perDomainEvents: Partial<Record<DomainKey, number>> = {};
  const countries = new Set<string>();
  // The KPI is "distinct travel days (any visible domain active)", so the day
  // KEYS are unioned. Adding each domain's own tally counted a day with a
  // flight and a hotel night twice, and could push the figure past 365 in a
  // year — the more domains a user keeps, the further off it read.
  const activeDayKeys = new Set<string>();
  let totalEvents = 0;
  // Only for domains that predate `dailyActiveDays`: their own tally is added
  // instead. Same trade as the country fallback below — over-reporting is
  // visible, under-reporting silently loses days.
  let activeDaysWithoutIndex = 0;


  for (const [key, stats] of Object.entries(statsMap)) {
    const domain = key as DomainKey;
    if (visible[domain] === false) continue;
    if (!stats || !isWithData(stats)) continue;

    let events = 0;
    if (year === null) {
      events = stats.totalEvents;
    } else {
      events = stats.yearlyEvents[year] ?? 0;
    }

    const daily = stats.dailyActiveDays as Record<string, number> | undefined;
    if (daily === undefined) {
      activeDaysWithoutIndex +=
        year === null ? sumValues(stats.yearlyActiveDays) : (stats.yearlyActiveDays[year] ?? 0);
    } else {
      const prefix = year === null ? null : `${year}-`;
      for (const day of Object.keys(daily)) {
        if (prefix !== null && !day.startsWith(prefix)) continue;
        activeDayKeys.add(day);
      }
    }
    perDomainEvents[domain] = events;
    totalEvents += events;

    // Country union. Lifetime takes the full set; a selected year takes that
    // year's slice from the backend's year-keyed index.
    //
    // This used to use the lifetime set for BOTH, which made the tile read
    // "34 countries" under a "Year 2017" header and left its year-over-year
    // delta badge structurally pinned at 0 (0%) — a comparison that could
    // not exist, rendered as if it were data.
    //
    // A domain without the index (older adapter, stub domain) falls back to
    // its lifetime set instead of contributing nothing: over-reporting is
    // visible, under-reporting silently loses countries.
    if (year === null || stats.countriesByYear === undefined) {
      stats.countries.forEach((c) => countries.add(c));
    } else {
      (stats.countriesByYear[year] ?? []).forEach((c) => countries.add(c));
    }
  }

  return {
    totalEvents,
    perDomainEvents,
    countriesCount: countries.size,
    activeDays: activeDayKeys.size + activeDaysWithoutIndex,
  };
}

export function isWithData(stats: DomainStats): stats is Extract<DomainStats, { hasData: true }> {
  return stats.hasData === true;
}

function sumValues(record: Record<string | number, number>): number {
  let sum = 0;
  for (const value of Object.values(record)) sum += value;
  return sum;
}

/** Years that show up across all visible domains, sorted ascending. */
export function collectYears(
  statsMap: DomainStatsMap,
  visible: Partial<Record<DomainKey, boolean>>
): number[] {
  const set = new Set<number>();
  for (const [key, stats] of Object.entries(statsMap)) {
    const domain = key as DomainKey;
    if (visible[domain] === false) continue;
    if (!stats || !isWithData(stats)) continue;
    Object.keys(stats.yearlyEvents).forEach((y) => set.add(Number(y)));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Pick the chronologically closest year to `current` from `years`,
 * skipping `current` itself. Ties prefer the older year so the user
 * lands on a "year-over-year change" comparison by default.
 */
export function pickAdjacentYear(years: number[], current: number | null): number | null {
  const candidates = years.filter((y) => y !== current);
  if (candidates.length === 0) return null;
  if (current === null) return candidates[candidates.length - 1];
  let best = candidates[0];
  let bestDist = Math.abs(best - current);
  for (const y of candidates) {
    const d = Math.abs(y - current);
    if (d < bestDist || (d === bestDist && y < best)) {
      best = y;
      bestDist = d;
    }
  }
  return best;
}

export interface CompareYearResolution {
  compareYear: number | null;
  /** True when no fallback year exists — comparison must be disabled. */
  disableCompare: boolean;
}

/**
 * Resolves a possibly-stale compare-year selection against the years
 * currently available. A persisted `compareYear` (issue #188) can go
 * stale in ways a same-session pick never could: the data set shrank
 * (deleted trips), the browser's localStorage carries a preference from
 * a different dataset, or fewer than 2 years exist at all. Returns
 * `null` when the current selection is still valid — the caller should
 * make no changes in that case. Otherwise returns the fallback year (or
 * `null` with `disableCompare: true` when no other year is available).
 */
export function resolveStaleCompareYear(
  years: number[],
  selectedYear: number | null,
  compareYear: number | null
): CompareYearResolution | null {
  if (compareYear === null) return null;
  const stale = !years.includes(compareYear) || compareYear === selectedYear;
  if (!stale) return null;
  const fallback = pickAdjacentYear(years, selectedYear);
  return { compareYear: fallback, disableCompare: fallback === null };
}

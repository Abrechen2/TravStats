// Pure aggregation helpers for the cross-domain overview. Take a
// DomainStatsMap + a DomainKey filter set, fold into the year-scoped
// shape the KPI / chart / heatmap components consume.
import type { DomainKey } from "../../../shared/domains";
import type { DomainStats, DomainStatsMap, YearScopedAgg } from "../../../lib/stats/domain-stats";
import { foldCrossDomain, type DomainContribution } from "../../../shared/crossDomainCounting";
import {
  eventsInWindow,
  windowFilter,
  type ComparisonWindow,
} from "../../../lib/stats/comparisonWindow";

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
  year: number | null,
  window: ComparisonWindow | null = null
): YearScopedAgg {
  const contributions: DomainContribution[] = [];
  // The window is cut on the CONTRIBUTIONS, before the fold — the unions
  // themselves live in `shared/crossDomainCounting.ts` and are the backend's
  // too. Narrowing what each domain hands over keeps one addition rule; a
  // second one that also knew about dates is how the panel and its tile come
  // to disagree.
  const withinWindow = windowFilter(year, window);

  for (const [key, stats] of Object.entries(statsMap)) {
    const domain = key as DomainKey;
    if (visible[domain] === false) continue;
    if (!stats || !isWithData(stats)) continue;

    // Events up to the window's end. `dailyEvents` sums per year to exactly
    // `yearlyEvents`, so an uncut year reads identically either way — but
    // summing the days is what lets a still-running year be set against the
    // same span of another one instead of against twelve months of it.
    const events = year === null ? stats.totalEvents : eventsInWindow(stats, year, window);

    const daily = stats.dailyActiveDays as Record<string, number> | undefined;
    // The KPI is "distinct travel days (any visible domain active)", so the
    // day KEYS travel to the fold and are unioned there. Only a domain
    // predating `dailyActiveDays` hands over a tally instead.
    const activeDayKeys = daily === undefined ? [] : Object.keys(daily).filter(withinWindow);
    const activeDaysWithoutIndex =
      daily !== undefined
        ? 0
        : year === null
          ? sumValues(stats.yearlyActiveDays)
          : (stats.yearlyActiveDays[year] ?? 0);

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
    //
    // It is NOT narrowed by the window, and cannot be: `countriesByYear` comes
    // from the server for three of the four domains and is keyed by year only.
    // Deriving a day-level index here would be a second source of truth for a
    // figure the evidence panel answers from the first. The KPI strip therefore
    // withholds the country DELTA under a same-period window rather than
    // publishing a comparison of two spans of different length.
    const countries =
      year === null || stats.countriesByYear === undefined
        ? stats.countries
        : (stats.countriesByYear[year] ?? []);

    contributions.push({ domain, events, countries, activeDayKeys, activeDaysWithoutIndex });
  }

  // The three additions themselves live in `shared/crossDomainCounting.ts`,
  // with the backend's `crossDomain*` evidence resolvers on the other side of
  // them. A union rule kept in two places is exactly how a panel comes to
  // disagree with the tile that opened it.
  return foldCrossDomain(contributions);
}

/**
 * The domains `aggregate` actually folded — which is not the same list as
 * the chips that are switched on: a domain whose fetch failed, or that has
 * no data at all, is absent from `statsMap` and contributes nothing.
 *
 * The evidence panel needs exactly this list, not the chip state, because
 * the scope it sends has to name the population the tile's number describes.
 * Sending a chip the fold skipped would ask the server to count rows the
 * tile did not.
 */
export function foldedDomains(
  statsMap: DomainStatsMap,
  visible: Partial<Record<DomainKey, boolean>>
): DomainKey[] {
  return (Object.entries(statsMap) as Array<[DomainKey, DomainStats | undefined]>)
    .filter(([domain, stats]) => visible[domain] !== false && stats && isWithData(stats))
    .map(([domain]) => domain);
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

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
  let totalEvents = 0;
  let activeDays = 0;

  for (const [key, stats] of Object.entries(statsMap)) {
    const domain = key as DomainKey;
    if (visible[domain] === false) continue;
    if (!stats || !isWithData(stats)) continue;

    let events = 0;
    if (year === null) {
      events = stats.totalEvents;
      activeDays += sumValues(stats.yearlyActiveDays);
    } else {
      events = stats.yearlyEvents[year] ?? 0;
      activeDays += stats.yearlyActiveDays[year] ?? 0;
    }
    perDomainEvents[domain] = events;
    totalEvents += events;

    // Country union: lifetime has the full set; year-scoped uses the
    // same set as a best-effort proxy until the backend exposes a
    // year-keyed country index. Documented as a known approximation.
    stats.countries.forEach((c) => countries.add(c));
  }

  return {
    totalEvents,
    perDomainEvents,
    countriesCount: countries.size,
    activeDays,
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

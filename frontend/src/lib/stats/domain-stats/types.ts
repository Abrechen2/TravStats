// Domain-stats contract — shared shape produced by every per-domain adapter.
import type { DomainKey } from "../../../shared/domains";

export interface DomainSummary {
  /** 2-3 short-form headline KPIs rendered on the per-domain card. */
  headlineKpis: Array<{ label: string; value: string | number }>;
  /** Optional ranked list (top airlines / cruise lines / hotel chains). */
  topItems?: { title: string; items: Array<{ label: string; value: number }> };
  /** Achievement-style boolean flags rendered as small pills. */
  badges?: Array<{ label: string; emoji: string }>;
  /** URL the "Details →" link on the summary card points to. */
  detailRoute: string;
}

/**
 * Cross-domain adapter output. Discriminated by `hasData`:
 *  - `hasData: false` is the resting state for not-yet-implemented domains
 *    (hotel, poi) so they can be wired into the overview without writing
 *    a real adapter yet.
 *  - `hasData: true` carries the full aggregate set the overview consumes.
 *
 * Time buckets use "active days" for `monthlyActiveDays` /
 * `yearlyActiveDays` so multi-day spans (cruises, hotel stays) don't
 * inflate event counts. `yearlyEvents` is the event tally — 1 flight,
 * 1 cruise, 1 stay, 1 visit each = 1 event.
 */
export type DomainStats =
  | { domain: DomainKey; hasData: false }
  | {
      domain: DomainKey;
      hasData: true;
      totalEvents: number;
      totalDistanceKm?: number;
      totalDurationHours?: number;
      countries: string[];
      /**
       * Countries keyed by year — the year-scoped counterpart to `countries`.
       * Optional so a domain adapter can be added without it; `aggregate`
       * then falls back to the lifetime set for that domain rather than
       * contributing nothing, because silently under-reporting a KPI is
       * harder to spot than over-reporting it.
       */
      countriesByYear?: Record<number, string[]>;
      yearlyEvents: Record<number, number>;
      yearlyActiveDays: Record<number, number>;
      monthlyActiveDays: Record<string, number>;
      /** YYYY-MM-DD -> 1 when this domain had any activity on that
       *  day. Multi-day events (cruises, hotel stays) populate every
       *  day they span. Sums across domains give the heatmap density. */
      dailyActiveDays: Record<string, number>;
      weekdayEvents: Record<number, number>;
      summary: DomainSummary;
    };

export type DomainStatsMap = Partial<Record<DomainKey, DomainStats>>;

/** Year-scoped slice helper used by the overview KPI / chart components. */
export interface YearScopedAgg {
  /** Total events across the visible domains for the requested year (or
   *  lifetime when `year` is null). */
  totalEvents: number;
  /** Per-domain breakdown of `totalEvents` — drives the
   *  "X Flüge · Y Kreuzfahrten" subtitle. */
  perDomainEvents: Partial<Record<DomainKey, number>>;
  /** Distinct countries touched. */
  countriesCount: number;
  /** Distinct travel days (any visible domain active). */
  activeDays: number;
}

import { AppError } from "../../middleware/errorHandler";
import type { EvidenceDomain, EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";
import {
  dayKeyInYear,
  foldCrossDomain,
  type DomainContribution,
} from "../../shared/crossDomainCounting";
import type { PagingParams } from "./paging";
import { pageDistinctEntries, pageSumEntries } from "./entryMappersDomains";
import {
  loadCrossDomainPopulation,
  type CrossDomainCountryRow,
  type CrossDomainEventRow,
} from "./crossDomainPopulations";

/**
 * The three `CrossDomainKpis` measures — the only ones in the registry whose
 * scope is `domainFiltered`, because they are the only numbers on the site
 * that change when the reader toggles a domain chip.
 *
 * All three answer through `shared/crossDomainCounting.ts`, the module
 * `frontend/.../Overview/aggregate.ts` folds with. Events ADD, countries and
 * days UNION; the fold is what says so, on both sides of the wire. What this
 * file adds is the per-entry attribution the tile never needed:
 * `crossDomainPopulations.ts` mirrors each adapter's rule for which rows
 * count, which year they fall in and which days and countries they prove.
 */

/**
 * `EvidenceDomain` and `DomainKey` are two vocabularies for four of the same
 * things: the evidence contract calls a point of interest a `place` (what
 * the ENTRY is) while the domain registry calls it `poi` (what the FEATURE
 * is), and the contract additionally knows `trip`, which is not a gated
 * domain at all. The request speaks the first, the populations the second.
 */
const DOMAIN_OF_EVIDENCE: Partial<Record<EvidenceDomain, DomainKey>> = {
  flight: "flight",
  cruise: "cruise",
  lodging: "lodging",
  place: "poi",
  roadtrip: "roadtrip",
  rail: "rail",
};

/**
 * The scope these three accept: a period of `allTime` or `year`, plus the
 * chips. `rolling12m` is refused — the strip offers lifetime or a year and
 * nothing between, so a rolling window would be a population the tile can
 * never show.
 *
 * Omitting `domains` means every domain, which is what a link shared without
 * the chips can honestly mean. The tiles always send theirs.
 */
function readScope(
  scope: EvidenceScope,
  key: string
): { year: number | null; domains: DomainKey[] } {
  if (scope.period.kind === "rolling12m") {
    throw new AppError(
      `${key} evidence supports period=allTime or period=year; got period=rolling12m.`,
      400
    );
  }
  const year = scope.period.kind === "year" ? scope.period.year : null;
  if (!scope.domains) return { year, domains: [...DOMAIN_KEYS] };
  const domains = scope.domains
    .map((domain) => DOMAIN_OF_EVIDENCE[domain])
    .filter((domain): domain is DomainKey => domain !== undefined);
  return { year, domains };
}

/** Groups rows by domain so each one's contribution reaches the fold whole. */
function byDomain<T extends { domain: DomainKey }>(rows: T[]): Map<DomainKey, T[]> {
  const grouped = new Map<DomainKey, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.domain);
    if (bucket) bucket.push(row);
    else grouped.set(row.domain, [row]);
  }
  return grouped;
}

/**
 * One experience each: a flight, a cruise, a stay, a place visit. A row with
 * no date belongs to no year, so a year scope drops it — the adapters count
 * it in `totalEvents` and in no `yearlyEvents` bucket, and the panel must
 * not invent a year the tile never claimed.
 */
export async function resolveCrossDomainEventCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const { year, domains } = readScope(scope, "crossDomainEventCount");
  const { events } = await loadCrossDomainPopulation(userId, domains);
  const matched = events.filter((row) => year === null || row.year === year);

  const contributions: DomainContribution[] = [...byDomain(matched)].map(([domain, rows]) => ({
    domain,
    events: rows.length,
    countries: [],
    activeDayKeys: [],
  }));
  const totals = foldCrossDomain(contributions);

  const entries: EvidenceEntry[] = matched.map((row) => ({ ...row.entry, contribution: 1 }));
  const paged = pageSumEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key: "crossDomainEventCount",
      aggregation: "sum",
      label: { key: "evidence.metric.crossDomainEventCount" },
      unit: "events",
      value: totals.totalEvents,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, contribution: paged.omittedContribution },
    unattributed: [],
    page,
  };
}

/**
 * The UNION of the countries the visible domains reached — ten flights prove
 * one country and one international flight proves two, which is the whole
 * reason this is `distinct` and not a sum.
 */
export async function resolveCrossDomainCountryCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const { year, domains } = readScope(scope, "crossDomainCountryCount");
  const { countryRows } = await loadCrossDomainPopulation(userId, domains);
  const matched: CrossDomainCountryRow[] = countryRows.filter(
    (row) => year === null || row.years.includes(year)
  );

  const contributions: DomainContribution[] = [...byDomain(matched)].map(([domain, rows]) => ({
    domain,
    events: 0,
    countries: rows.flatMap((row) => row.countries),
    activeDayKeys: [],
  }));
  const totals = foldCrossDomain(contributions);

  const entries: EvidenceEntry[] = matched.map((row) => ({
    ...row.entry,
    credits: row.countries,
  }));
  const paged = pageDistinctEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key: "crossDomainCountryCount",
      aggregation: "distinct",
      label: { key: "evidence.metric.crossDomainCountryCount" },
      unit: "countries",
      value: totals.countriesCount,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, credits: paged.omittedCredits },
    unattributed: [],
    page,
  };
}

/**
 * Distinct travel days, unioned on the DAY KEY. A day with a flight and a
 * hotel night is one day; adding each domain's own tally counted it twice
 * and could push the figure past 365 in a year.
 *
 * A row with no day proves none and stays out of the list entirely — unlike
 * the event count, where it is still an experience. A cruise's days fall in
 * the calendar years they actually happened in, so a New Year crossing
 * contributes to BOTH while its event counts only in the year it began.
 */
export async function resolveCrossDomainActiveDayCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const { year, domains } = readScope(scope, "crossDomainActiveDayCount");
  const { events } = await loadCrossDomainPopulation(userId, domains);
  const matched: Array<CrossDomainEventRow & { credits: string[] }> = events
    .map((row) => ({ ...row, credits: row.dayKeys.filter((day) => dayKeyInYear(day, year)) }))
    .filter((row) => row.credits.length > 0);

  const contributions: DomainContribution[] = [...byDomain(matched)].map(([domain, rows]) => ({
    domain,
    events: 0,
    countries: [],
    activeDayKeys: rows.flatMap((row) => row.credits),
  }));
  const totals = foldCrossDomain(contributions);

  const entries: EvidenceEntry[] = matched.map((row) => ({ ...row.entry, credits: row.credits }));
  const paged = pageDistinctEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key: "crossDomainActiveDayCount",
      aggregation: "distinct",
      label: { key: "evidence.metric.crossDomainActiveDayCount" },
      unit: "days",
      value: totals.activeDays,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, credits: paged.omittedCredits },
    unattributed: [],
    page,
  };
}

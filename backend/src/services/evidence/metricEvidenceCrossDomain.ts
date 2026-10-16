import { AppError } from "../../middleware/errorHandler";
import type { EvidenceDomain, EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";
import { BETA_GATED_DOMAINS, loadVisibleDomains } from "../domainVisibility";
import {
  dayKeyInYear,
  foldCrossDomain,
  visitedCountryContribution,
  visitedSourcesOfRows,
  type DomainContribution,
} from "../../shared/crossDomainCounting";
import { loadPassport } from "../stats/passportLoader";
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
  rental: "rental",
  bus: "bus",
  ferry: "ferry",
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

/**
 * The scope's domains, without a beta domain this user does not see
 * (forgejo#265: bus, rail, roadtrips, rentals behind the instance's beta
 * switch or the user's own toggle). The overview never fetches such a domain,
 * so a panel opened by a link without chips — which means "every domain" —
 * must not name its rows either. The other domains follow the chips, as
 * before.
 */
async function readVisibleScope(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<{ year: number | null; domains: DomainKey[] }> {
  const { year, domains } = readScope(scope, key);
  const visible = new Set(await loadVisibleDomains(userId));
  return {
    year,
    domains: domains.filter((d) => BETA_GATED_DOMAINS[d] === undefined || visible.has(d)),
  };
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
  const { year, domains } = await readVisibleScope(userId, scope, "crossDomainEventCount");
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
 * "Länder besucht" over the visible domains: the passport's visited rule
 * (forgejo#299), scoped by chip and year through each row's `visitSources`
 * — the same index the tile folds. Before this it unioned every country a
 * record touched, so a connection or an open-jaw end counted as a visit here
 * while the passport, under the same words, did not count it.
 *
 * The rows listed are the domain's records, each crediting only the visited
 * countries its own domain proves. A visited country no listed row names (a
 * lodging the population files under another year, say) is reported as
 * unattributed rather than dropped from the number.
 */
export async function resolveCrossDomainCountryCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const { year, domains } = await readVisibleScope(userId, scope, "crossDomainCountryCount");
  const [{ countryRows }, passport] = await Promise.all([
    loadCrossDomainPopulation(userId, domains),
    loadPassport(userId),
  ]);
  const sources = visitedSourcesOfRows(passport.countries);
  const visitedBy = new Map(
    domains.map((domain) => [domain, new Set(visitedCountryContribution(sources, domain, year))])
  );

  const contributions: DomainContribution[] = domains.map((domain) => ({
    domain,
    events: 0,
    countries: [...(visitedBy.get(domain) ?? [])],
    activeDayKeys: [],
  }));
  const totals = foldCrossDomain(contributions);

  const matched: Array<CrossDomainCountryRow & { credits: string[] }> = countryRows
    .filter((row) => year === null || row.years.includes(year))
    .map((row) => ({
      ...row,
      credits: row.countries.filter((code) => visitedBy.get(row.domain)?.has(code)),
    }))
    .filter((row) => row.credits.length > 0);
  const credited = new Set(matched.flatMap((row) => row.credits));
  const uncredited = new Set(
    contributions.flatMap((c) => c.countries).filter((code) => !credited.has(code))
  ).size;

  const entries: EvidenceEntry[] = matched.map((row) => ({ ...row.entry, credits: row.credits }));
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
    unattributed: uncredited > 0 ? [{ count: uncredited, reason: "notPerEntry" }] : [],
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
  const { year, domains } = await readVisibleScope(userId, scope, "crossDomainActiveDayCount");
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

import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { pageDistinctEntries, pageSumEntries } from "./entryMappersDomains";

/**
 * The `EvidenceResponse` envelope the cruise, lodging and places measures
 * share, in one place — the non-flight twin of `flightMeasureResponse.ts`.
 *
 * It differs from that file in one way that matters: the entries arrive
 * ALREADY BUILT. A flight measure pages first and hydrates the page, because
 * its population is the whole account and only the page's flight numbers are
 * needed. Every measure served from here works over a set the resolver has
 * loaded in full anyway — the cruise itineraries with their ports, the stays
 * with their houses — so a second query for the page would be work with
 * nothing to save.
 *
 * What stays with each resolver is the only part that is not boilerplate:
 * which rows are in the population, and what each one contributes or
 * witnesses.
 */

/**
 * The scope the three domain tabs accept: the year pill, or lifetime.
 *
 * `CruiseStatsSection`, `LodgingStatsSection` and `PoiStatsSection` all render
 * with `scope.year === null` — that is the tab's default — so `allTime` is a
 * population every one of these tiles really shows, and the registry lists it
 * beside `year` (corrected in task 7b-3; it listed `year` alone). A rolling
 * window is refused: the period strip offers lifetime or a calendar year and
 * nothing between, so a rolling answer would be a population no tile can
 * display.
 *
 * Returns `undefined` for lifetime rather than `null`, because that is what
 * `startedIn()` and the two loaders already take for "no year filter".
 */
export function readYearScope(scope: EvidenceScope, key: string): number | undefined {
  if (scope.period.kind === "rolling12m") {
    throw new AppError(
      `${key} evidence supports period=allTime or period=year; got period=rolling12m.`,
      400
    );
  }
  return scope.period.kind === "year" ? scope.period.year : undefined;
}

interface DomainSumArgs {
  key: string;
  unit: string;
  scope: EvidenceScope;
  page: PagingParams;
  /** Already built and already filtered to the population this measure counts. */
  entries: EvidenceEntry[];
  /**
   * The figure the surface renders. Passed rather than summed here because
   * several of these come from the calculator's own accumulator
   * (`stats.seaDays`, `stats.totalNights`) — comparing the resolver's own
   * addition against itself would prove nothing, while handing the
   * calculator's number in makes `assertSumInvariant` a real check that the
   * per-row split adds back up to it.
   */
  value: number | null;
  /** The surface's own rounding step, applied ONCE to the total. */
  round?: (total: number) => number;
  unattributed?: EvidenceResponse["unattributed"];
}

export function domainSumEvidence({
  key,
  unit,
  scope,
  page,
  entries,
  value,
  round = Math.round,
  unattributed = [],
}: DomainSumArgs): EvidenceResponse {
  const paged = pageSumEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key,
      aggregation: "sum",
      label: { key: `evidence.metric.${key}` },
      unit,
      value: value === null ? null : round(value),
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, contribution: paged.omittedContribution },
    unattributed,
    page,
  };
}

interface DomainDistinctArgs {
  key: string;
  unit: string;
  scope: EvidenceScope;
  page: PagingParams;
  entries: EvidenceEntry[];
  /**
   * The surface's own count. Optional: where the calculator's figure IS the
   * union of the credits (every cruise's ports, every stay's continent), the
   * union is the honest value and recomputing it here keeps one source. Pass
   * it where the surface folds the set further — the cruise tab counts ISO
   * codes, not port-catalogue country names.
   */
  value?: number;
}

export function domainDistinctEvidence({
  key,
  unit,
  scope,
  page,
  entries,
  value,
}: DomainDistinctArgs): EvidenceResponse {
  const paged = pageDistinctEntries(entries, page);
  return {
    measure: {
      kind: "metric",
      key,
      aggregation: "distinct",
      label: { key: `evidence.metric.${key}` },
      unit,
      // The UNION of credited units, never a row count — one cruise witnesses
      // eight ports and eight cruises can witness one line.
      value: value ?? new Set(entries.flatMap((e) => e.credits ?? [])).size,
      scope,
    },
    entries: paged.entries,
    returned: paged.entries.length,
    omitted: { count: paged.omittedCount, credits: paged.omittedCredits },
    unattributed: [],
    page,
  };
}

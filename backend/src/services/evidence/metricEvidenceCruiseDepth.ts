import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { isRiverCruise } from "../../shared/cruiseKind";
import type { CruiseStats } from "../../utils/cruiseStats";
import type { CruiseStatsRow } from "../stats/cruiseStatsData";
import type { PagingParams } from "./paging";
import { domainSumEvidence } from "./domainMeasureResponse";
import { entryOf, loadScoped, type ScopedCruises } from "./metricEvidenceCruise";

/**
 * The populations behind the cruise tab's key figures that are a ratio, an
 * extreme or a streak (forgejo#257): ports per cruise, the most catalogued
 * ports on one cruise, the revisit rate, the river cruises and the deepest
 * deck. Release 1 serves sums only (owner, 2026-09-18), so each opens the
 * sailed cruises its figure is read from, with what each brings.
 *
 * Like `metricEvidenceCruise.ts`, nothing here re-derives a rule: each
 * cruise's share is `calculateCruiseStats` run on that cruise alone, and the
 * per-cruise accumulators read here ADD across cruises, so the list sums to
 * the rollup's own total.
 */

type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

interface Picked {
  contribution: number;
  subtitle?: EvidenceEntry["subtitle"];
}

function sailedSum(
  key: string,
  unit: string,
  pick: (row: CruiseStatsRow, own: CruiseStats) => Picked | null,
  value: (scoped: ScopedCruises) => number
): Resolver {
  return async (userId, scope, page) => {
    const scoped = await loadScoped(userId, scope, key);
    const entries = scoped.rows.flatMap((row) => {
      const picked = pick(row, scoped.own.get(row.id)!);
      return picked
        ? [entryOf(row, { contribution: picked.contribution, subtitle: picked.subtitle ?? null })]
        : [];
    });
    return domainSumEvidence({ key, unit, scope, page, entries, value: value(scoped) });
  };
}

/**
 * Every port call of the effective itinerary, unrecognised ones included —
 * the numerator of "ports per cruise".
 */
export const resolveCruisePortCallsTotal = sailedSum(
  "cruisePortCallsTotal",
  "ports",
  (_row, own) => (own.totalPortCalls > 0 ? { contribution: own.totalPortCalls } : null),
  (scoped) => scoped.total.totalPortCalls
);

/**
 * Calls at CATALOGUE ports — the most on one cruise is the largest row, and
 * the revisit rate is read over exactly these calls (an unrecognised call is
 * never a revisit).
 */
export const resolveCruiseCataloguePortCallsTotal = sailedSum(
  "cruiseCataloguePortCallsTotal",
  "ports",
  (_row, own) => (own.resolvedPortCalls > 0 ? { contribution: own.resolvedPortCalls } : null),
  (scoped) => scoped.total.resolvedPortCalls
);

/** River cruises — exactly the tile's count. */
export const resolveCruiseRiverCount = sailedSum(
  "cruiseRiverCount",
  "cruises",
  (row) => (isRiverCruise(row.input) ? { contribution: 1 } : null),
  (scoped) => scoped.total.riverCruisesCount
);

/** Sailed cruises with a deck recorded, each naming its deck — the deepest deck's population. */
export const resolveCruiseSailedDeckCount = sailedSum(
  "cruiseSailedDeckCount",
  "cruises",
  (row) =>
    row.input.deck !== null
      ? {
          contribution: 1,
          subtitle: { key: "evidence.subtitle.deck", values: { deck: row.input.deck } },
        }
      : null,
  (scoped) => scoped.rows.filter((row) => row.input.deck !== null).length
);

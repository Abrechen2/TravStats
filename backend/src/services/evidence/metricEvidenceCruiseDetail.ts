import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { cruiseNights, listedPortCalls } from "../../shared/cruiseRowFacts";
import { loadCruiseStatsData, type CruiseStatsRow } from "../stats/cruiseStatsData";
import type { PagingParams } from "./paging";
import { cruiseEvidenceEntry } from "./entryMappersDomains";
import { domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The entries behind the cruise tab's row-level blocks — rhythm and fun
 * (forgejo#257): the busiest month, the average, longest and shortest cruise,
 * the first cruise, the most port calls, the highest deck and the cruises on
 * a trip.
 *
 * Most of those tiles name ONE cruise or an average, and release 1 serves
 * only `sum` and `distinct` (owner, 2026-09-18). So each tile opens the
 * POPULATION its figure is read from, with what every cruise brings to it:
 * the longest cruise is the row with the most nights in `cruiseNightsTotal`,
 * the first cruise the oldest row of `cruiseDatedCount`. That is the list the
 * reader needs to check the figure — and it cannot disagree with it, because
 * the per-cruise numbers come from `shared/cruiseRowFacts.ts`, the module the
 * tab's own fold (`lib/stats/cruiseStatsDetail.ts`) reads.
 *
 * THE POPULATION IS THE CRUISE LIST, not the rollup's sailed cruises: the tab
 * folds these blocks over `cruiseApi.list()`, which applies no status filter,
 * so a booked and a cancelled cruise are in them too. The panel lists the
 * same rows — `loadCruiseStatsData(…, "every")`, as `cruiseCompanionCount`
 * does for the same reason — and the counting help says so.
 */

async function loadRows(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<CruiseStatsRow[]> {
  const year = readYearScope(scope, key);
  return (await loadCruiseStatsData(userId, year, "every")).rows;
}

function entryOf(
  row: CruiseStatsRow,
  contribution: number,
  subtitle: EvidenceEntry["subtitle"] = null
): EvidenceEntry {
  return cruiseEvidenceEntry(
    { id: row.id, label: row.label, startDate: row.startDate },
    { contribution, subtitle }
  );
}

type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

/**
 * A sum over the cruise list: `pick` answers what one cruise contributes, or
 * null when it is not part of the population at all (and so not listed).
 */
function cruiseListSum(
  key: string,
  unit: string,
  pick: (
    row: CruiseStatsRow
  ) => { contribution: number; subtitle?: EvidenceEntry["subtitle"] } | null
): Resolver {
  return async (userId, scope, page) => {
    const rows = await loadRows(userId, scope, key);
    const entries = rows.flatMap((row) => {
      const picked = pick(row);
      return picked ? [entryOf(row, picked.contribution, picked.subtitle ?? null)] : [];
    });
    const value = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
    return domainSumEvidence({ key, unit, scope, page, entries, value });
  };
}

/**
 * Cruises with a start date — the population of the busiest month, the two
 * calendar charts and the first cruise. Listed by date, so the first cruise
 * leads the list and a month's cruises stand together.
 */
export const resolveCruiseDatedCount = cruiseListSum("cruiseDatedCount", "cruises", (row) =>
  row.startDate ? { contribution: 1 } : null
);

/**
 * Nights per cruise, where both dates are known — the population of the
 * average, the longest and the shortest cruise. A cruise ending the day it
 * began is listed with 0 nights, because the average counts it.
 */
export const resolveCruiseNightsTotal = cruiseListSum("cruiseNightsTotal", "nights", (row) => {
  const nights = cruiseNights(row.input.startDate, row.input.endDate);
  return nights === null ? null : { contribution: nights };
});

/**
 * Port calls listed in each itinerary — the population of "most ports on one
 * cruise". A cruise with none listed is left out: it has nothing to compare.
 */
export const resolveCruiseListedPortCallsTotal = cruiseListSum(
  "cruiseListedPortCallsTotal",
  "ports",
  (row) => {
    const calls = listedPortCalls(row.input.stops);
    return calls > 0 ? { contribution: calls } : null;
  }
);

/** Cruises with a deck recorded, each naming its deck — the highest-deck tile's population. */
export const resolveCruiseDeckRecordedCount = cruiseListSum(
  "cruiseDeckRecordedCount",
  "cruises",
  (row) =>
    typeof row.input.deck === "number"
      ? {
          contribution: 1,
          subtitle: { key: "evidence.subtitle.deck", values: { deck: row.input.deck } },
        }
      : null
);

/** Cruises filed under a trip — exactly the tile's own count. */
export const resolveCruiseOnTripCount = cruiseListSum("cruiseOnTripCount", "cruises", (row) =>
  row.tripId ? { contribution: 1 } : null
);

import type { EvidenceScope } from "../../shared/evidence";
import { DOMAINS } from "../../shared/domains";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { loadDistanceEntries } from "../stats/yearStats/loadEntries";
import type { PagingParams } from "./paging";
import { domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * "Strecke im Logbuch" on the statistics page's "Jahre" section (feat/year-stats): the
 * entries of every domain the user sees, each with its own kilometres, over the SAME rows
 * the section folds (`services/stats/yearStats/loadEntries.ts`), so the panel and the
 * figure read one sum. Lifetime for the section's total, a calendar year for a year card.
 * An entry without a measured distance is not listed; the response counts it as abstained.
 */
const round1 = (n: number): number => Math.round(n * 10) / 10;

export async function resolveLoggedDistanceKm(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "loggedDistanceKm";
  const year = readYearScope(scope, key);
  const inScope = (await loadDistanceEntries(userId, new Date())).filter(
    (e) => year === undefined || e.month.startsWith(`${year}-`)
  );
  const entries: EvidenceEntry[] = inScope.flatMap((e) =>
    e.ref && e.km !== null && e.km > 0
      ? [
          {
            // Only travel domains carry a distance (the loaders), each an evidence domain too.
            domain: e.domain as EvidenceEntry["domain"],
            id: e.ref.id,
            href: `${DOMAINS[e.domain].routePrefix}/${e.ref.id}`,
            title: { text: e.ref.label },
            subtitle: null,
            date: { value: e.ref.day, precision: "day" },
            contribution: e.km,
          } satisfies EvidenceEntry,
        ]
      : []
  );
  const total = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  return domainSumEvidence({
    key,
    unit: "km",
    scope,
    page,
    entries,
    value: entries.length === 0 ? null : total,
    round: round1,
    abstained: inScope.length - entries.length,
  });
}

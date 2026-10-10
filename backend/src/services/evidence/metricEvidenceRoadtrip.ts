import { now as clockNow } from "../../shared/time/clock";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { roadtripCountsIn } from "../../shared/tour/roadtripListScope";
import { loadRoadtripListFacts, type RoadtripListFacts } from "../roadtrip/roadtripList";
import type { PagingParams } from "./paging";
import { dayPrecisionDate } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The evidence behind the roadtrip tab's four list tiles (forgejo#260):
 * roadtrips, distance, nights and countries. The tiles fold the roadtrip LIST
 * (`GET /roadtrips`) in the browser; this reads the same rows through the same
 * derivations (`services/roadtrip/roadtripList.ts`) and cuts them by the same
 * rule (`shared/tour/roadtripListScope.ts`): a roadtrip that has not started
 * counts nowhere, one that has belongs to the year it started.
 *
 * The distance is the WHOLE route of every counted roadtrip — the tile says
 * so, and that what is still ahead on one under way is in it. The kilometres
 * already driven are `roadtripDrivenKm` of the insights.
 */
type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

async function scoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<RoadtripListFacts[]> {
  const year = readYearScope(scope, key) ?? null;
  const now = clockNow();
  return (await loadRoadtripListFacts(userId)).filter((r) =>
    roadtripCountsIn(r.startDate, year, now)
  );
}

function entryOf(
  r: RoadtripListFacts,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">
): EvidenceEntry {
  return {
    domain: "roadtrip",
    id: r.id,
    href: `/roadtrips/${r.id}`,
    title: { text: r.name },
    // The span start is UTC midnight of the station's own day — the day itself.
    date: dayPrecisionDate(r.startDate === null ? null : new Date(r.startDate)),
    ...fields,
  };
}

/** Roadtrips, one each; the subtitle names the vehicle, which the vehicles list ranks. */
export const resolveRoadtripCount: Resolver = async (userId, scope, page) => {
  const key = "roadtripCount";
  const entries = (await scoped(userId, scope, key)).map((r) =>
    entryOf(r, {
      contribution: 1,
      subtitle: { key: `evidence.subtitle.vehicle.${r.vehicle ?? "unknown"}` },
    })
  );
  return domainSumEvidence({ key, unit: "roadtrips", scope, page, entries, value: entries.length });
};

/** The whole route of each roadtrip, every mode — rounded once, on the total. */
export const resolveRoadtripRouteKm: Resolver = async (userId, scope, page) => {
  const key = "roadtripRouteKm";
  const rows = await scoped(userId, scope, key);
  const entries = rows.map((r) => entryOf(r, { contribution: r.distanceKm, subtitle: null }));
  const value = rows.reduce((sum, r) => sum + r.distanceKm, 0);
  return domainSumEvidence({ key, unit: "km", scope, page, entries, value });
};

/**
 * Nights by the one night rule (`countRoadtripNights`): a linked stay's nights
 * once, a free pitch's own. A roadtrip with a night of unknown length says so.
 */
export const resolveRoadtripNightsTotal: Resolver = async (userId, scope, page) => {
  const key = "roadtripNightsTotal";
  const rows = await scoped(userId, scope, key);
  const entries = rows
    .filter((r) => r.nights > 0 || !r.nightsKnown)
    .map((r) =>
      entryOf(r, {
        contribution: r.nights,
        subtitle: r.nightsKnown ? null : { key: "evidence.subtitle.nightsUnknown" },
      })
    );
  const value = rows.reduce((sum, r) => sum + r.nights, 0);
  return domainSumEvidence({ key, unit: "nights", scope, page, entries, value });
};

/** Countries of the stations (the station-country rule); a roadtrip proving none stays listed. */
export const resolveRoadtripCountriesCount: Resolver = async (userId, scope, page) => {
  const key = "roadtripCountriesCount";
  const entries = (await scoped(userId, scope, key)).map((r) =>
    entryOf(r, { credits: r.countries, subtitle: null })
  );
  return domainDistinctEvidence({ key, unit: "countries", scope, page, entries });
};

export const ROADTRIP_LIST_RESOLVERS: Record<string, Resolver> = {
  roadtripCount: resolveRoadtripCount,
  roadtripRouteKm: resolveRoadtripRouteKm,
  roadtripNightsTotal: resolveRoadtripNightsTotal,
  roadtripCountriesCount: resolveRoadtripCountriesCount,
};

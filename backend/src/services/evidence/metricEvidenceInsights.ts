import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { INSIGHT_MEASURES } from "../../shared/evidenceMeasuresInsights";
import { lodgingInsights, placeInsights } from "../stats/insights";
import { itemsFor, type MeasureItem, type MeasureItems } from "../stats/insights/measureItems";
import type { PagingParams } from "./paging";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The evidence behind the statistics-expansion figures (forgejo#258/#259/
 * #260/#264). One resolver shape for all of them, because every insight
 * module already emits its entries while it counts: the panel pages the SAME
 * items the tile's number was folded from. `assertSumInvariant` therefore
 * checks something real — the per-row split against the figure the endpoint
 * answers — rather than a second computation against itself.
 */

type ItemLoader = (userId: string) => Promise<MeasureItems>;

const LOADERS: Record<string, ItemLoader> = {
  lodging: async (userId) => (await lodgingInsights(userId)).items,
  places: async (userId) => (await placeInsights(userId)).items,
};

/** Which loader owns a key: the measure's domain prefix in the registry. */
const OWNER: Record<string, keyof typeof LOADERS> = {
  lodgingWeekendNights: "lodging",
  lodgingWeekdayNights: "lodging",
  lodgingBusinessNights: "lodging",
  lodgingReturnHouseCount: "lodging",
  placeDiscoveryVisits: "places",
  placeRevisitVisits: "places",
  placeVisitsWithPhoto: "places",
  placeVisitsWithNote: "places",
  placeVisitsWithRating: "places",
};

function toEntry(item: MeasureItem, distinct: boolean): EvidenceEntry {
  return {
    ...item.entry,
    ...(distinct
      ? {
          credits: item.credits ?? [],
          ...(item.creditLabels ? { creditLabels: item.creditLabels } : {}),
        }
      : { contribution: item.contribution ?? 0 }),
  };
}

function resolverFor(key: string) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const spec = INSIGHT_MEASURES[key];
    const year = readYearScope(scope, key);
    if (year !== undefined && !spec.scopes.includes("year")) {
      throw new AppError(`${key} evidence is lifetime only; got period=year.`, 400);
    }
    const all = (await LOADERS[OWNER[key]](userId))[key] ?? [];
    const distinct = spec.aggregation === "distinct";
    const entries = itemsFor(all, year).map((item) => toEntry(item, distinct));
    if (distinct) {
      return domainDistinctEvidence({ key, unit: spec.unit, scope, page, entries });
    }
    const value = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
    return domainSumEvidence({ key, unit: spec.unit, scope, page, entries, value });
  };
}

/** Every insight key, bound to its resolver — spread into `METRIC_RESOLVERS`. */
export const INSIGHT_RESOLVERS = Object.fromEntries(
  Object.keys(OWNER).map((key) => [key, resolverFor(key)])
);

/**
 * Evidence measures — the places tab's rhythm, quality and fun-fact cards and
 * the roadtrip tab's list tiles (forgejo#259, #260). Both fold in the browser
 * (`lib/stats/poiStatsDetail.ts`, the roadtrip list); the resolvers read the
 * same rows through the same rules (`shared/placeCounting.ts` with
 * `shared/placeRhythm.ts`, `shared/tour/roadtripListScope.ts`).
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresPlaceRoadtripDetail.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const POI = "lib/stats/poiStatsDetail.ts derivePoiStats (client fold over listPlaces)";
const ROADTRIP_LIST =
  "GET /roadtrips (services/roadtrip/roadtripList.ts), cut by shared/tour/roadtripListScope.ts";

const measure = (
  aggregation: "sum" | "distinct",
  unit: string,
  surface: string,
  calculator: string
): MeasureSpec => ({
  aggregation,
  unit,
  scopes: ["allTime", "year"],
  surface,
  calculator,
  servedIn: 1,
});

export const PLACE_ROADTRIP_DETAIL_MEASURES: Record<string, MeasureSpec> = {
  placeBusiestMonthVisits: measure("sum", "visits", "PoiRhythmSection", POI),
  placeBusiestWeekdayVisits: measure("sum", "visits", "PoiRhythmSection", POI),
  placeBusiestDayPlaces: measure("distinct", "places", "PoiRhythmSection", POI),
  placeLongestStreakDays: measure("distinct", "days", "PoiRhythmSection", POI),
  placeRatedVisitCount: measure("sum", "visits", "PoiQualitySection", POI),
  placeFirstVisit: measure("sum", "visits", "PoiFunSection", POI),
  placeFavouriteVisits: measure("sum", "visits", "PoiFunSection", POI),
  placeCategoriesUsedCount: measure("distinct", "categories", "PoiFunSection", POI),
  placeNorthernmost: measure("distinct", "places", "PoiFunSection", POI),
  placeSouthernmost: measure("distinct", "places", "PoiFunSection", POI),
  placeVisitsOnTripsCount: measure("sum", "visits", "PoiFunSection", POI),
  /** The trip with the most categories in the period, crediting each category once. */
  placeVarietyTripCategories: measure(
    "distinct",
    "categories",
    "PoiInsightsSection",
    "utils/placeInsights computeDiversity (GET /stats/insights/places)"
  ),

  roadtripCount: measure("sum", "roadtrips", "RoadtripStatsSection", ROADTRIP_LIST),
  /** The whole route, every mode, including what is still ahead on one under way. */
  roadtripRouteKm: measure("sum", "km", "RoadtripStatsSection", ROADTRIP_LIST),
  roadtripNightsTotal: measure("sum", "nights", "RoadtripStatsSection", ROADTRIP_LIST),
  roadtripCountriesCount: measure("distinct", "countries", "RoadtripStatsSection", ROADTRIP_LIST),
};

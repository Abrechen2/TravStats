/**
 * Evidence measures — the statistics expansion (forgejo#258 lodging, #259
 * places, #260 roadtrips, #264 day tours). Each figure is folded from the very
 * entries its panel lists (`services/stats/insights/measureItems.ts`), so a
 * tile and its panel are one computation, not two that agree by care.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresInsights.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const CALCULATOR =
  "services/evidence/metricEvidenceInsights.ts over services/stats/insights (GET /stats/insights/*)";

const insight = (
  aggregation: "sum" | "distinct",
  unit: string,
  surface: string,
  scopes: MeasureSpec["scopes"] = ["allTime", "year"]
): MeasureSpec => ({ aggregation, unit, scopes, surface, calculator: CALCULATOR, servedIn: 1 });

export const INSIGHT_MEASURES: Record<string, MeasureSpec> = {
  lodgingWeekendNights: insight("sum", "nights", "LodgingInsightsSection"),
  lodgingWeekdayNights: insight("sum", "nights", "LodgingInsightsSection"),
  /** Only trips the user marked "business" — never inferred from a weekday. */
  lodgingBusinessNights: insight("sum", "nights", "LodgingInsightsSection"),
  /** Houses with stays in two or more calendar years; a lifetime question. */
  lodgingReturnHouseCount: insight("distinct", "lodgings", "LodgingInsightsSection", ["allTime"]),

  /** A place's first dated visit, when no undated visit of it could be earlier. */
  placeDiscoveryVisits: insight("sum", "visits", "PoiInsightsSection"),
  placeRevisitVisits: insight("sum", "visits", "PoiInsightsSection"),
  /** Photo, note and rating are three independent questions, never one score. */
  placeVisitsWithPhoto: insight("sum", "visits", "PoiInsightsSection"),
  placeVisitsWithNote: insight("sum", "visits", "PoiInsightsSection"),
  placeVisitsWithRating: insight("sum", "visits", "PoiInsightsSection"),
  /** Places visited in two or more calendar years — the list under the longest pause. */
  placeReturningPlaceCount: insight("distinct", "places", "PoiInsightsSection", ["allTime"]),
  /** The two visits the longest straight-line jump runs between. */
  placeLongestJumpVisits: insight("sum", "visits", "PoiInsightsSection", ["allTime"]),

  /**
   * Road legs that have HAPPENED (shared/tour/roadtripTimeline.ts): what the
   * vehicle itself drove — never next week's, never a ferry or a train.
   */
  roadtripDrivenKm: insight("sum", "km", "RoadtripInsightsSection"),
  /** Ferry legs — carried, never driven. */
  roadtripFerryKm: insight("sum", "km", "RoadtripInsightsSection"),
  roadtripRecordedNights: insight("sum", "nights", "RoadtripInsightsSection"),
  /** Driving days the pace median is taken over; a day belongs to the year of its date. */
  roadtripDayStages: insight("sum", "stages", "RoadtripInsightsSection"),
  /** Completed day tours from a roadtrip's stations, in the roadtrip's year. */
  roadtripToursAlongCount: insight("sum", "tours", "RoadtripInsightsSection"),

  /** Recorded, or dated before today (shared/tour/tourCounting.ts). */
  tourCompletedCount: insight("sum", "tours", "TourStatsSection"),
  /** The recording where there is one, else the route — the panel says which per tour. */
  tourDistanceKm: insight("sum", "km", "TourStatsSection"),
  /** Recordings only; a tour without a measured climb is not in the sum. */
  tourAscentM: insight("sum", "metres", "TourStatsSection"),
  tourMovingMinutes: insight("sum", "minutes", "TourStatsSection"),
  /** What a tour hangs on (forgejo#264) — overlapping, never added up. */
  tourLinkedCount: insight("sum", "tours", "TourStatsSection"),
  tourOnTripCount: insight("sum", "tours", "TourStatsSection"),
  tourFromRoadtripCount: insight("sum", "tours", "TourStatsSection"),
  tourDuringCruiseCount: insight("sum", "tours", "TourStatsSection"),
  tourStandaloneCount: insight("sum", "tours", "TourStatsSection"),
  /** Countries at the tours' starting points, from the boundary set. */
  tourCountriesCount: insight("distinct", "countries", "TourStatsSection"),
  /** Tours holding a personal record, over all years like the records. */
  tourRecordTours: insight("sum", "tours", "TourStatsSection", ["allTime"]),
};

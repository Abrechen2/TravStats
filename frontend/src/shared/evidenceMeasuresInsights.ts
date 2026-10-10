/**
 * Evidence measures — the statistics expansion (forgejo#258 lodging, #259
 * places, #260 roadtrips, #264 day tours). Each figure is folded from the very
 * entries its panel lists (`services/stats/insights/measureItems.ts`), so a
 * tile and its panel are one computation, not two that agree by care.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresInsights.ts`.
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
  /** The nights the sleeping-style shares are taken over: known length, filed in a year. */
  lodgingSleepStyleNights: insight("sum", "nights", "LodgingInsightsSection"),
  /** Weekend plus weekday nights: every night with a hotel-local date. */
  lodgingCalendarWeekNights: insight("sum", "nights", "LodgingInsightsSection"),
  /** Finished trips with dated stays — the median of moves is read over these. */
  lodgingCompletedTripBaseCount: insight("sum", "trips", "LodgingInsightsSection"),
  /** Like-for-like price comparisons (same house, room, board, currency); lifetime only. */
  lodgingPriceComparisonCount: insight("sum", "comparisons", "LodgingInsightsSection", ["allTime"]),
  /** Months of a year holding a night — the "once through the calendar" tile, per year. */
  lodgingCalendarMonthCount: insight("distinct", "months", "LodgingInsightsSection"),

  /** A place's first dated visit, when no undated visit of it could be earlier. */
  placeDiscoveryVisits: insight("sum", "visits", "PoiInsightsSection"),
  placeRevisitVisits: insight("sum", "visits", "PoiInsightsSection"),
  /** Photo, note and rating are three independent questions, never one score. */
  placeVisitsWithPhoto: insight("sum", "visits", "PoiInsightsSection"),
  placeVisitsWithNote: insight("sum", "visits", "PoiInsightsSection"),
  placeVisitsWithRating: insight("sum", "visits", "PoiInsightsSection"),

  /**
   * Road legs that have HAPPENED (shared/tour/roadtripTimeline.ts): what the
   * vehicle itself drove — never next week's, never a ferry or a train.
   */
  roadtripDrivenKm: insight("sum", "km", "RoadtripInsightsSection"),
  /** Ferry legs — carried, never driven. */
  roadtripFerryKm: insight("sum", "km", "RoadtripInsightsSection"),
  roadtripRecordedNights: insight("sum", "nights", "RoadtripInsightsSection"),

  /** Recorded, or dated before today (shared/tour/tourCounting.ts). */
  tourCompletedCount: insight("sum", "tours", "TourStatsSection"),
  /** The recording where there is one, else the route — the panel says which per tour. */
  tourDistanceKm: insight("sum", "km", "TourStatsSection"),
  /** Recordings only; a tour without a measured climb is not in the sum. */
  tourAscentM: insight("sum", "metres", "TourStatsSection"),
  tourMovingMinutes: insight("sum", "minutes", "TourStatsSection"),
};

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

  /** A place's first dated visit, when no undated visit of it could be earlier. */
  placeDiscoveryVisits: insight("sum", "visits", "PoiInsightsSection"),
  placeRevisitVisits: insight("sum", "visits", "PoiInsightsSection"),
  /** Photo, note and rating are three independent questions, never one score. */
  placeVisitsWithPhoto: insight("sum", "visits", "PoiInsightsSection"),
  placeVisitsWithNote: insight("sum", "visits", "PoiInsightsSection"),
  placeVisitsWithRating: insight("sum", "visits", "PoiInsightsSection"),

  /** Kilometres that have HAPPENED (shared/tour/roadtripTimeline.ts) — never next week's. */
  roadtripRecordedKm: insight("sum", "km", "RoadtripInsightsSection"),
  /** Road legs only: what the vehicle itself rolled. */
  roadtripDrivenKm: insight("sum", "km", "RoadtripInsightsSection"),
  /** Ferry legs — carried, never driven. */
  roadtripFerryKm: insight("sum", "km", "RoadtripInsightsSection"),
  roadtripRecordedNights: insight("sum", "nights", "RoadtripInsightsSection"),
};

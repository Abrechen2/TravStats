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
};

/**
 * Evidence measures — the rail tab of the Statistics page and the rail badges
 * (2.7). Each counts the rides `shared/railCounting.ts` counts (completed
 * only), filed under the year a ride LEFT on its departure station's calendar;
 * what kind of ride it was comes from `shared/railRideKinds.ts`, the same
 * rule the badges ask (`utils/railAchievements.ts`), so a badge's progress
 * and the rides listed behind it are one computation.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresRail.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const RAIL_CALCULATOR =
  "services/evidence/metricEvidenceRail.ts over utils/railAchievements.ts railRideFacts";

const railMeasure = (aggregation: "sum" | "distinct", unit: string): MeasureSpec => ({
  aggregation,
  unit,
  scopes: ["allTime", "year"],
  surface: "RailStatsSection",
  calculator: RAIL_CALCULATOR,
  servedIn: 1,
});

export const RAIL_MEASURES: Record<string, MeasureSpec> = {
  railRideCount: railMeasure("sum", "rides"),
  /** Every distance source together — the straight line is a lower bound of the track. */
  railDistanceKmTotal: railMeasure("sum", "km"),
  railCountriesCount: railMeasure("distinct", "countries"),
  railOperatorsCount: railMeasure("distinct", "operators"),
  railNightTrainCount: railMeasure("sum", "rides"),
  railHighSpeedRideCount: railMeasure("sum", "rides"),
  railCrossBorderRideCount: railMeasure("sum", "rides"),
  // forgejo#261 — the journey figures, over the same counted rides.
  railJourneyCount: railMeasure("sum", "journeys"),
  railDocumentedTransferJourneyCount: railMeasure("sum", "journeys"),
  railNightTrainNights: railMeasure("sum", "nights"),
  railNewConnectionsCount: railMeasure("sum", "connections"),
};

import { now } from "../../../shared/time/clock";
import { computeLodgingInsights } from "../../../utils/lodgingInsights";
import { computePlaceInsights } from "../../../utils/placeInsights";
import type { PlaceInsightsResponse } from "../../../schemas/statsInsights/places";
import { loadPlaceInsightPlaces } from "./placeInsightData";
import type { LodgingInsightsResponse } from "../../../schemas/statsInsights/lodging";
import { loadLodgingInsightStays } from "./lodgingInsightData";
import { totalsOf, type MeasureItems } from "./measureItems";

/**
 * The statistics-expansion insights, one builder per domain. Each returns the
 * view the statistics tab draws AND — through the same computation — the
 * entries the evidence panel lists, so a tile and its panel are one pass.
 */
export async function lodgingInsights(
  userId: string,
  at: Date = now()
): Promise<{ response: LodgingInsightsResponse; items: MeasureItems }> {
  const { insights, items, plannedStays } = computeLodgingInsights(
    await loadLodgingInsightStays(userId),
    at
  );
  return { response: { ...insights, plannedStays, totals: totalsOf(items) }, items };
}

export async function placeInsights(
  userId: string,
  at: Date = now()
): Promise<{ response: PlaceInsightsResponse; items: MeasureItems }> {
  const { insights, items } = computePlaceInsights(await loadPlaceInsightPlaces(userId), at);
  return { response: { ...insights, totals: totalsOf(items) }, items };
}

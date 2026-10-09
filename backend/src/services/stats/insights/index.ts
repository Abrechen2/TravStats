import { now } from "../../../shared/time/clock";
import { computeLodgingInsights } from "../../../utils/lodgingInsights";
import { computePlaceInsights } from "../../../utils/placeInsights";
import type { PlaceInsightsResponse } from "../../../schemas/statsInsights/places";
import { loadPlaceInsightPlaces } from "./placeInsightData";
import { computeRoadtripInsights, type RoadtripInsights } from "../../../utils/roadtripInsights";
import { tourFacts, type TourFacts } from "../../../utils/tourInsights/tourFacts";
import { computeTourInsights } from "../../../utils/tourInsights";
import type { TourInsightsResponse } from "../../../schemas/statsInsights/tours";
import type { RoadtripInsightsResponse } from "../../../schemas/statsInsights/roadtrips";
import { getCountryResolver } from "../../geo/countryFromCoordinates";
import { loadInsightRoadtrips } from "./roadtripInsightData";
import { loadInsightTours } from "./tourInsightData";
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

/** Every tour of a user with its facts — shared by the roadtrip and tour insights. */
export async function loadTourFacts(
  userId: string,
  at: Date = now(),
  options: { withElevation?: boolean } = {}
): Promise<TourFacts[]> {
  const resolver = await getCountryResolver();
  return (await loadInsightTours(userId, resolver, options)).map((t) => tourFacts(t, at));
}

/** Rows a caller already loaded, so one badge check reads each source once (review I4). */
export interface Preloaded {
  tours?: TourFacts[];
}

export async function roadtripInsights(
  userId: string,
  at: Date = now(),
  preloaded: Preloaded = {}
): Promise<{
  response: RoadtripInsightsResponse;
  items: MeasureItems;
  awards: RoadtripInsights["awards"];
}> {
  const [roadtrips, tours, resolver] = await Promise.all([
    loadInsightRoadtrips(userId),
    preloaded.tours ?? loadTourFacts(userId, at),
    getCountryResolver(),
  ]);
  const { insights, items } = computeRoadtripInsights(roadtrips, tours, resolver, at);
  const { awards, ...view } = insights;
  return { response: { ...view, totals: totalsOf(items) }, items, awards };
}

export async function tourInsights(
  userId: string,
  at: Date = now(),
  preloaded: Preloaded = {}
): Promise<{ response: TourInsightsResponse; items: MeasureItems }> {
  const { insights, items } = computeTourInsights(
    preloaded.tours ?? (await loadTourFacts(userId, at))
  );
  return { response: { ...insights, totals: totalsOf(items) }, items };
}

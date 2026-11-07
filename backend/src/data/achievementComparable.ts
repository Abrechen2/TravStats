import type { AchievementDefinition } from "./achievements";

/**
 * Which badges may be compared with a friend (snapshot v2, forgejo#416).
 *
 * The rule: a badge is comparable when its requirement is a generic count or
 * measure ("25 airports", "10 000 km", "5 stays"). It is NOT comparable when
 * it names a specific place, region, route, flight number or fixed list, when
 * it reads a personal date (a birthday) or the user's whereabouts (latitude,
 * TravTrack), or when it is hidden — a hidden badge is a surprise, and a
 * friend's table must not spoil it. A friend learns "unlocked or not" and a
 * progress fraction, so anything that would let that reveal where the user
 * has been stays out.
 */
export const NON_COMPARABLE_REQUIREMENT_TYPES: ReadonlySet<string> = new Set([
  // a specific place, region, airport, route or fixed list
  "antarctic_flight",
  "arctic_flight",
  "airport_alphabet",
  "carnival_brands_all",
  "cruise_canal_transit",
  "cruise_cold_water",
  "cruise_dateline_crossing",
  "cruise_equator_crossing",
  "cruise_polar",
  "cruise_region_baltic_or_fjords",
  "cruise_region_caribbean",
  "cruise_region_mediterranean",
  "equator_crossing",
  "groundhog_route",
  "high_altitude_airports",
  "island_flights",
  "micro_states_visited",
  "ocean_crossing",
  "pilgrim_airports",
  "same_route",
  "scandinavia_set",
  "time_travel",
  "curated_list_ticked:museum-warships",
  "curated_list_ticked:world-heritage",
  "curated_list_ticked:world-wonders-ancient",
  "curated_list_ticked:world-wonders-new7",
  // a flight number
  "flight_number_666",
  "flight_number_777_on_777",
  // the user's whereabouts, by latitude or by tracking
  "lodging_northern_lat",
  "lodging_southern_lat",
  "place_northern_lat",
  "place_southern_lat",
  "travtrack_days",
  "travtrack_ground_km",
  // a personal date
  "birthday_flights",
  "cruise_birthday_at_sea",
  "lodging_birthday_stay",
]);

export function isComparable(
  a: Pick<AchievementDefinition, "requirementType" | "isHidden">
): boolean {
  return !a.isHidden && !NON_COMPARABLE_REQUIREMENT_TYPES.has(a.requirementType);
}

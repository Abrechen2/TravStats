import type { TourActivity } from "../../shared/tour/roadtrip";

/**
 * Strava's `sport_type` to a tour's activity and default leg mode. Anything
 * Strava invents later lands on `other`/`foot`, which is honest: an unknown
 * sport is an activity we cannot name, not a hike.
 */
const TABLE: Record<string, { activity: TourActivity; mode: "foot" | "bike" }> = {
  Hike: { activity: "hike", mode: "foot" },
  Walk: { activity: "walk", mode: "foot" },
  Run: { activity: "run", mode: "foot" },
  TrailRun: { activity: "run", mode: "foot" },
  VirtualRun: { activity: "run", mode: "foot" },
  Ride: { activity: "bike", mode: "bike" },
  GravelRide: { activity: "bike", mode: "bike" },
  EBikeRide: { activity: "bike", mode: "bike" },
  VirtualRide: { activity: "bike", mode: "bike" },
  MountainBikeRide: { activity: "mtb", mode: "bike" },
  EMountainBikeRide: { activity: "mtb", mode: "bike" },
  AlpineSki: { activity: "ski", mode: "foot" },
  BackcountrySki: { activity: "ski", mode: "foot" },
  NordicSki: { activity: "ski", mode: "foot" },
  Snowshoe: { activity: "hike", mode: "foot" },
  Kayaking: { activity: "paddle", mode: "foot" },
  Canoeing: { activity: "paddle", mode: "foot" },
  StandUpPaddling: { activity: "paddle", mode: "foot" },
  Rowing: { activity: "paddle", mode: "foot" },
  RockClimbing: { activity: "climb", mode: "foot" },
};

export function activityFromSportType(sportType: string): {
  activity: TourActivity;
  mode: "foot" | "bike";
} {
  return TABLE[sportType] ?? { activity: "other", mode: "foot" };
}

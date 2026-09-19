/**
 * What an achievement rule's number counts, where the count has a unit.
 *
 * Beta audit 2026-09-19, unlisted finding 4 (part of #330): a locked
 * achievement's progress read `495456 / 500000` — no separators, and no hint
 * that the figure is kilometres. Six digits without a grouping mark is a
 * number nobody can read at a glance, and "500000" beside a distance badge
 * looks like a count of flights.
 *
 * Only rules whose number is NOT simply "how many of the thing" appear here.
 * The overwhelming majority ("10 flights", "25 airports") name their unit in
 * the badge's own description already, and repeating it behind the fraction
 * would be noise — those get the separators and nothing else.
 *
 * The value is the suffix of an i18n key under `achievements:progress.units`,
 * because a unit IS user-facing copy: hours are "Std." on a German page.
 */
export const ACHIEVEMENT_PROGRESS_UNIT: Record<string, string> = {
  distance_km: "km",
  single_flight_distance: "km",
  cruise_distance_km: "km",
  cruise_longest_leg_km: "km",
  flight_hours: "hours",
  sea_days: "days",
  sea_days_streak: "days",
  lodging_nights: "nights",
  lodging_award_nights: "nights",
  lodging_streak_nights: "nights",
  lodging_programme_year_nights: "nights",
  lodging_independent_nights: "nights",
  lodging_five_star_nights: "nights",
  lodging_all_inclusive_nights: "nights",
};

/** The unit i18n suffix for a rule, or null when the number counts itself. */
export function progressUnitForRule(requirementType: string): string | null {
  return ACHIEVEMENT_PROGRESS_UNIT[requirementType] ?? null;
}

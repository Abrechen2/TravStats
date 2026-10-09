import type { AchievementDefinition } from "../achievements";

/**
 * Badges of the 2026-10 statistics expansion (forgejo#256 flights, #257
 * cruises), measured by `utils/insightAchievements.ts` over the same folds the
 * statistics page draws. Every threshold below is a PRODUCT PROPOSAL from the
 * audit issues and is marked as such until the owner confirms it.
 *
 * Compared with the catalogue before adding (forgejo#256): no badge measures
 * airports per year, the pause between two visits, or one airport across a
 * year. `YEAR_ROUND` (partA, `all_seasons`) is the nearest and is NOT this —
 * it counts northern-hemisphere seasons over any flights, while the quarter
 * badge asks one airport in all four CALENDAR quarters of one year.
 *
 * Copy is German (the seed language); English lives in
 * `frontend/src/i18n/resources/en/achievements.json` under `codes.<CODE>`.
 */
export const seedsInsights: AchievementDefinition[] = [
  {
    code: "NEW_GROUND_YEAR",
    name: "Neulandjahr",
    description: "Mindestens fünf Flughäfen in einem Jahr zum ersten Mal erfasst",
    category: "explorer",
    domain: "flight",
    icon: "🧭",
    tier: "silver",
    requirement: 5, // threshold: proposal forgejo#256, owner to confirm
    requirementType: "flight_new_airports_year",
    points: 50,
  },
  {
    code: "LONG_TIME_NO_SEE",
    name: "Lange nicht gesehen",
    description: "Zu einem Flughafen zurückgekehrt, nach mindestens zehn erfassten Jahren",
    category: "special",
    domain: "flight",
    icon: "🕰️",
    tier: "gold",
    requirement: 10, // threshold: proposal forgejo#256, owner to confirm
    requirementType: "flight_airport_reunion_years",
    points: 80,
  },
  {
    code: "FOUR_QUARTERS_AIRPORT",
    name: "Jahreszeiten-Wiedersehen",
    description: "Denselben Flughafen in allen vier Kalenderquartalen eines Jahres genutzt",
    category: "special",
    domain: "flight",
    icon: "🗓️",
    tier: "silver",
    requirement: 4, // threshold: proposal forgejo#256, owner to confirm
    requirementType: "flight_airport_all_quarters",
    points: 50,
  },
];

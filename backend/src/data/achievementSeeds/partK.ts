import type { AchievementDefinition } from "../achievements";

/**
 * Part K — the statistics expansion (forgejo#258 lodging, #259 places, #260
 * roadtrips, #264 day tours). Measured by `utils/insightAchievements.ts` from
 * the same computation the statistics tab draws (`services/stats/insights`),
 * so a badge and the figure beside it can never disagree.
 *
 * EVERY THRESHOLD HERE IS A PRODUCT PROPOSAL from the 2026-10-08 audit and is
 * marked so; the owner confirms or changes them. Each was compared with the
 * existing catalogue first: none duplicates a rule — the nearest ones
 * (LODGING_TYPES_*, RETURNER_*, PLACE_CATEGORIES_*) count over a lifetime or
 * count stays, where these count within one trip, across calendar years, or
 * across one year's months.
 *
 * Held only while the live measure meets the rule (owner ruling 2026-09-20,
 * `achievementWrites.ts`) — nothing here is "once earned, forever".
 *
 * Copy is German (user-facing); English lives in the achievements locale.
 */
export const seedsPartK: AchievementDefinition[] = [
  {
    code: "LODGING_FOUR_WORLDS",
    name: "Vier Schlafwelten",
    description: "Vier verschiedene Unterkunftsarten auf einer abgeschlossenen Reise",
    category: "explorer",
    domain: "lodging",
    icon: "🛏️",
    tier: "silver",
    // threshold: proposal forgejo#258, owner to confirm
    requirement: 4,
    requirementType: "lodging_trip_types_max",
    points: 60,
  },
  {
    code: "LODGING_WELCOME_YEARS_5",
    name: "Jahrelang willkommen",
    description: "Dasselbe Haus in fünf verschiedenen Kalenderjahren besucht",
    category: "special",
    domain: "lodging",
    icon: "🗝️",
    tier: "gold",
    // threshold: proposal forgejo#258, owner to confirm
    requirement: 5,
    requirementType: "lodging_same_house_years",
    points: 100,
  },
  {
    code: "LODGING_FULL_CALENDAR",
    name: "Einmal durch den Kalender",
    description: "In jedem Monat eines Kalenderjahres mindestens eine Nacht auswärts geschlafen",
    category: "elite",
    domain: "lodging",
    icon: "🗓️",
    tier: "gold",
    // threshold: proposal forgejo#258, owner to confirm
    requirement: 12,
    requirementType: "lodging_months_in_year",
    points: 120,
  },
];

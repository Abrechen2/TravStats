import type { AchievementDefinition } from "../achievements";

/**
 * TravTrack badges (forgejo#400), measured by `utils/travTrackAchievements.ts`
 * from the monthly values the privacy-safe projection writes — a zone's fixes
 * are in no figure. TravTrack is not a domain, so these carry `shared` and are
 * listed by their own rule alone (`TRAVTRACK_BADGE_CODES`, read by
 * `services/achievementVisibility.ts`): only while TravTrack is this account's
 * working location source. Off, they are neither listed, counted nor scored,
 * and their stored rows are left untouched (`SKIP`).
 */
export const seedsPartN: AchievementDefinition[] = [
  {
    code: "TRAVTRACK_DAYS_30",
    name: "Spur gehalten",
    description: "An 30 Tagen mit TravTrack unterwegs aufgezeichnet",
    category: "explorer",
    domain: "shared",
    icon: "📍",
    tier: "bronze",
    // threshold: proposal, owner to confirm
    requirement: 30,
    requirementType: "travtrack_days",
    points: 15,
  },
  {
    code: "TRAVTRACK_DAYS_365",
    name: "Ein Jahr auf der Spur",
    description: "An 365 Tagen mit TravTrack aufgezeichnet",
    category: "explorer",
    domain: "shared",
    icon: "🗓️",
    tier: "silver",
    // threshold: proposal, owner to confirm
    requirement: 365,
    requirementType: "travtrack_days",
    points: 50,
  },
  {
    code: "TRAVTRACK_KM_1000",
    name: "Tausend Kilometer am Boden",
    description: "1.000 Kilometer am Boden von TravTrack gemessen",
    category: "distance",
    domain: "shared",
    icon: "🥾",
    tier: "bronze",
    // threshold: proposal, owner to confirm
    requirement: 1000,
    requirementType: "travtrack_ground_km",
    points: 20,
  },
  {
    code: "TRAVTRACK_KM_10000",
    name: "Zehntausend Kilometer am Boden",
    description: "10.000 Kilometer am Boden von TravTrack gemessen",
    category: "distance",
    domain: "shared",
    icon: "🛤️",
    tier: "silver",
    // threshold: proposal, owner to confirm
    requirement: 10000,
    requirementType: "travtrack_ground_km",
    points: 60,
  },
];

/** The TravTrack badges: listed by the TravTrack rule alone (`achievementVisibility.ts`). */
export const TRAVTRACK_BADGE_CODES: ReadonlySet<string> = new Set(seedsPartN.map((a) => a.code));

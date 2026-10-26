import type { AchievementDefinition } from "../achievements";

/**
 * Ferry badges, measured by `utils/ferryAchievements.ts` and handed to the
 * planner by `utils/domainAchievementChecks.ts`. Hidden while the user has
 * the ferry domain off (`services/achievementVisibility.ts`).
 *
 * The thresholds mirror the bus badges' first rungs; the owner has not
 * confirmed them yet.
 */
export const seedsPartM: AchievementDefinition[] = [
  {
    code: "FERRY_FIRST",
    name: "Leinen los",
    description: "Die erste Fährüberfahrt abgeschlossen",
    category: "explorer",
    domain: "ferry",
    icon: "⛴️",
    tier: "bronze",
    // threshold: proposal, owner to confirm
    requirement: 1,
    requirementType: "ferry_count",
    points: 10,
  },
  {
    code: "FERRY_NIGHT",
    name: "Nacht an Bord",
    description: "Eine Fährüberfahrt über Nacht, belegt durch Abfahrts- und Ankunftszeit",
    category: "special",
    domain: "ferry",
    icon: "🌙",
    tier: "bronze",
    // threshold: proposal, owner to confirm
    requirement: 1,
    requirementType: "ferry_night_crossings",
    points: 20,
  },
  {
    code: "FERRY_PORTS_5",
    name: "Hafen für Hafen",
    description: "Fünf verschiedene Fährhäfen angelaufen",
    category: "collector",
    domain: "ferry",
    icon: "⚓",
    tier: "silver",
    // threshold: proposal, owner to confirm
    requirement: 5,
    requirementType: "ferry_ports",
    points: 40,
  },
];

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
  {
    code: "FERRY_10",
    name: "Stammgast an Bord",
    description: "10 Fährüberfahrten abgeschlossen",
    category: "explorer",
    domain: "ferry",
    icon: "🎫",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10,
    requirementType: "ferry_count",
    points: 50,
  },
  {
    code: "FERRY_50",
    name: "Fährkapitän ehrenhalber",
    description: "50 Fährüberfahrten abgeschlossen",
    category: "explorer",
    domain: "ferry",
    icon: "🚢",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 50,
    requirementType: "ferry_count",
    points: 150,
  },
  {
    code: "FERRY_KM_1000",
    name: "Tausend Kilometer Wasser",
    description: "1.000 km mit der Fähre zurückgelegt",
    category: "distance",
    domain: "ferry",
    icon: "🌊",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 1000,
    requirementType: "ferry_km",
    points: 30,
  },
  {
    code: "FERRY_KM_5000",
    name: "Fünftausend Kilometer Meer",
    description: "5.000 km mit der Fähre zurückgelegt",
    category: "distance",
    domain: "ferry",
    icon: "🌍",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 5000,
    requirementType: "ferry_km",
    points: 100,
  },
  {
    code: "FERRY_COUNTRIES_3",
    name: "Über das Wasser in drei Länder",
    description: "Fährhäfen in drei Ländern erreicht",
    category: "explorer",
    domain: "ferry",
    icon: "🗺️",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 3,
    requirementType: "ferry_countries",
    points: 25,
  },
  {
    code: "FERRY_COUNTRIES_10",
    name: "Zehn Länder zur See",
    description: "Fährhäfen in zehn Ländern erreicht",
    category: "explorer",
    domain: "ferry",
    icon: "🧭",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10,
    requirementType: "ferry_countries",
    points: 100,
  },
  {
    code: "FERRY_PORTS_15",
    name: "Fünfzehn Häfen",
    description: "Fünfzehn verschiedene Fährhäfen angelaufen",
    category: "collector",
    domain: "ferry",
    icon: "⚓",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 15,
    requirementType: "ferry_ports",
    points: 80,
  },
  {
    code: "FERRY_LINES_5",
    name: "Fünf Reedereien",
    description: "Mit fünf verschiedenen Fährlinien gefahren",
    category: "collector",
    domain: "ferry",
    icon: "🏷️",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 5,
    requirementType: "ferry_operators",
    points: 40,
  },
  {
    code: "FERRY_VEHICLE",
    name: "Mit dem Auto an Bord",
    description: "Eine Überfahrt mit Fahrzeug",
    category: "special",
    domain: "ferry",
    icon: "🚗",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 1,
    requirementType: "ferry_vehicle",
    points: 20,
  },
];

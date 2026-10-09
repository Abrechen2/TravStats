import type { AchievementDefinition } from "../achievements";

/**
 * Rental, bus and cross-domain badges (forgejo#262, #263, #265).
 *
 * The domain ones are measured by `utils/rentalAchievements.ts` and
 * `utils/busAchievements.ts`, the shared ones by
 * `utils/crossDomainAchievements.ts`; `utils/domainAchievementChecks.ts`
 * hands all three to the planner. A rental or bus badge is hidden while its
 * domain's beta switch is off (`services/achievementVisibility.ts`).
 *
 * The thresholds are the issues' product proposals, marked one by one for
 * the owner to confirm.
 */
export const seedsPartK: AchievementDefinition[] = [
  {
    code: "RENTAL_FIRST",
    name: "Erste Schlüssel",
    description: "Die erste Miete abgeschlossen",
    category: "explorer",
    domain: "rental",
    icon: "🔑",
    tier: "bronze",
    // threshold: proposal forgejo#262, owner to confirm
    requirement: 1,
    requirementType: "rental_count",
    points: 10,
  },
  {
    code: "RENTAL_ONE_WAY",
    name: "Anderswo abgegeben",
    description: "Einen Mietwagen an einer anderen Station zurückgegeben als abgeholt",
    category: "special",
    domain: "rental",
    icon: "↪️",
    tier: "bronze",
    // threshold: proposal forgejo#262, owner to confirm
    requirement: 1,
    requirementType: "rental_one_way",
    points: 20,
  },
  {
    code: "RENTAL_ODOMETER_5",
    name: "Kilometerbuch",
    description: "Fünf abgeschlossene Mieten mit Anfangs- und Endkilometerstand",
    category: "collector",
    domain: "rental",
    icon: "📒",
    tier: "silver",
    // threshold: proposal forgejo#262, owner to confirm
    requirement: 5,
    requirementType: "rental_odometer_documented",
    points: 40,
  },
];

import type { DomainAchievementCheck } from "./achievementWrites";
import { calculateRentalAchievementStats, checkRentalAchievement } from "./rentalAchievements";
import { calculateBusAchievementStats, checkBusAchievement } from "./busAchievements";
import {
  calculateCrossDomainAchievementStats,
  checkCrossDomainAchievement,
  type CrossDomainAchievementStats,
} from "./crossDomainAchievements";

/**
 * The badge checks of the domains that arrived after rail (forgejo#262 ff.)
 * and of the cross-domain trip badges (forgejo#265), loaded in one call so
 * `achievements.ts` — near its size limit — names one line for all of them.
 * Each domain module measures its own rows regardless of the beta switch,
 * like rail: a badge's date stays true the day the gate opens, and
 * `achievementVisibility` keeps a hidden domain's badges out of every list,
 * count and point total meanwhile. The cross-domain measures are the
 * exception and say why in `crossDomainAchievements.ts`: a SHARED badge is
 * always listed, so a hidden domain must not feed it.
 *
 * `crossDomain` is handed back too: `achievements.ts` still files the fully
 * documented trip under `UserStats`, and it must be this number, not a second
 * count.
 */
export async function loadDomainAchievementChecks(userId: string): Promise<{
  checks: DomainAchievementCheck[];
  crossDomain: CrossDomainAchievementStats;
}> {
  const [rental, bus, crossDomain] = await Promise.all([
    calculateRentalAchievementStats(userId),
    calculateBusAchievementStats(userId),
    calculateCrossDomainAchievementStats(userId),
  ]);
  return {
    checks: [
      (achievement) => checkRentalAchievement(achievement, rental),
      (achievement) => checkBusAchievement(achievement, bus),
      (achievement) => checkCrossDomainAchievement(achievement, crossDomain),
    ],
    crossDomain,
  };
}

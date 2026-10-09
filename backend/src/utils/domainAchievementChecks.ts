import type { DomainAchievementCheck } from "./achievementWrites";
import { calculateRentalAchievementStats, checkRentalAchievement } from "./rentalAchievements";
import { calculateBusAchievementStats, checkBusAchievement } from "./busAchievements";

/**
 * The badge checks of the domains that arrived after rail (forgejo#262 ff.),
 * loaded in one call so `achievements.ts` — near its size limit — names one
 * line for all of them. Each module measures its own rows regardless of the
 * beta switch, like rail: a badge's date stays true the day the gate opens,
 * and `achievementVisibility` keeps a hidden domain's badges out of every
 * list, count and point total meanwhile.
 */
export async function loadDomainAchievementChecks(
  userId: string
): Promise<DomainAchievementCheck[]> {
  const [rental, bus] = await Promise.all([
    calculateRentalAchievementStats(userId),
    calculateBusAchievementStats(userId),
  ]);
  return [
    (achievement) => checkRentalAchievement(achievement, rental),
    (achievement) => checkBusAchievement(achievement, bus),
  ];
}

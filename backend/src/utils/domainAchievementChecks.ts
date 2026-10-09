import type { DomainAchievementCheck } from "./achievementWrites";
import { SKIP, settleBadgeSource } from "./badgeSource";
import {
  calculateRentalAchievementStats,
  checkRentalAchievement,
  RENTAL_REQUIREMENT_TYPES,
} from "./rentalAchievements";
import {
  BUS_REQUIREMENT_TYPES,
  calculateBusAchievementStats,
  checkBusAchievement,
} from "./busAchievements";
import {
  calculateCrossDomainAchievementStats,
  checkCrossDomainAchievement,
  CROSS_DOMAIN_REQUIREMENT_TYPES,
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
 * A module whose loader THROWS does not abort the run: it goes through the
 * check's one failure rule (`badgeSource.ts`) — its rules answer `SKIP`, and
 * their stored rows stay exactly as they are (no revocation by a zero, no
 * write). Every other badge is checked as usual.
 *
 * `crossDomain` is handed back too (null after a failure): `achievements.ts` still files the fully
 * documented trip under `UserStats`, and it must be this number, not a second
 * count.
 */
export async function loadDomainAchievementChecks(userId: string): Promise<{
  checks: DomainAchievementCheck[];
  crossDomain: CrossDomainAchievementStats | null;
}> {
  const [rental, bus, crossDomain] = await Promise.all([
    settleBadgeSource(userId, "rental", () => calculateRentalAchievementStats(userId)),
    settleBadgeSource(userId, "bus", () => calculateBusAchievementStats(userId)),
    settleBadgeSource(userId, "crossDomain", () => calculateCrossDomainAchievementStats(userId)),
  ]);
  const or = <S>(
    stats: S | null,
    types: readonly string[],
    check: (a: Parameters<DomainAchievementCheck>[0], s: S) => ReturnType<DomainAchievementCheck>
  ): DomainAchievementCheck =>
    stats === null
      ? (a) => (types.includes(a.requirementType) ? SKIP : null)
      : (a) => check(a, stats);
  return {
    checks: [
      or(rental, RENTAL_REQUIREMENT_TYPES, checkRentalAchievement),
      or(bus, BUS_REQUIREMENT_TYPES, checkBusAchievement),
      or(crossDomain, CROSS_DOMAIN_REQUIREMENT_TYPES, checkCrossDomainAchievement),
    ],
    crossDomain,
  };
}

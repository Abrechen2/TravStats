import { prisma } from "../../db";
import type { AchievementSection, LeaderboardScope } from "../../schemas/comparison";
import type { AchievementDefinition } from "../../data/achievements";
import { SHARED_BADGE_DOMAINS } from "../../data/achievementSeeds/partL";
import { isAchievementHeld } from "../../utils/achievementHeld";
import { loadAchievementVisibility } from "../achievementVisibility";
import { loadVisibleDomains } from "../domainVisibility";
import { catalogueVersion, comparableAchievements } from "./achievementCatalogue";

/**
 * Every domain a badge reads must be in the consent. A domain badge reads its own; a shared one
 * reads the domains `SHARED_BADGE_DOMAINS` names, or — when it names none — every domain the
 * owner has visible (it spans trips, and a partial scope would leak the withheld ones).
 */
function domainsRead(a: AchievementDefinition, visible: readonly string[]): readonly string[] {
  if (a.domain !== "shared") return [a.domain];
  return SHARED_BADGE_DOMAINS[a.code] ?? visible;
}

/**
 * The achievements part of snapshot v2: lifetime only, comparable badges only, no dates.
 * Undefined unless the consent carries the `achievements` group and no single year.
 */
export async function buildAchievementSection(
  userId: string,
  scope: LeaderboardScope
): Promise<AchievementSection | undefined> {
  if (!scope.groups.includes("achievements") || scope.year !== null) return undefined;
  const [visibleFor, visibleDomains] = await Promise.all([
    loadAchievementVisibility(userId),
    loadVisibleDomains(userId),
  ]);
  const shown = comparableAchievements().filter(
    (a) =>
      visibleFor(a.domain, a.code) &&
      domainsRead(a, visibleDomains).every((d) => scope.domains.includes(d as never))
  );
  const rows = await prisma.userAchievement.findMany({
    where: { userId, achievement: { code: { in: shown.map((a) => a.code) } } },
    select: { progress: true, achievement: { select: { code: true } } },
  });
  const byCode = new Map(rows.map((r) => [r.achievement.code, r] as const));
  return {
    catalogue: catalogueVersion(),
    items: shown.map((a) => {
      const row = byCode.get(a.code);
      return {
        code: a.code,
        unlocked: isAchievementHeld(row, a.requirement),
        progress:
          a.requirement > 0 ? Math.min(1, Math.max(0, (row?.progress ?? 0) / a.requirement)) : null,
      };
    }),
  };
}

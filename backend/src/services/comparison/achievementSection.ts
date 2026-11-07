import { prisma } from "../../db";
import type {
  AchievementSection,
  LeaderboardRow,
  LeaderboardScope,
  LeaderboardSnapshot,
} from "../../schemas/comparison";
import type { AchievementDefinition } from "../../data/achievements";
import { AVAILABLE_DOMAINS } from "../../shared/domains";
import { isAchievementHeld } from "../../utils/achievementHeld";
import { loadAchievementVisibility } from "../achievementVisibility";
import { catalogueVersion, comparableAchievements } from "./achievementCatalogue";

/**
 * Every domain a badge reads must be in the consent. A domain badge reads its own. A shared one
 * spans trips, and neither `SHARED_BADGE_DOMAINS` (a visibility rule) nor today's visible domains
 * (they change when a domain is switched off, while the stored progress keeps what it counted)
 * says what its figure was built from, so it needs the consent to cover every available domain.
 */
function domainsRead(a: AchievementDefinition): readonly string[] {
  return a.domain === "shared" ? AVAILABLE_DOMAINS : [a.domain];
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
  const visibleFor = await loadAchievementVisibility(userId);
  const shown = comparableAchievements().filter(
    (a) =>
      visibleFor(a.domain, a.code) &&
      domainsRead(a).every((d) => scope.domains.includes(d as never))
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

/**
 * What a leaderboard row says about a friend's achievements, from the snapshot it carries. A
 * year view has none by design; a v1 snapshot comes from a server that cannot send them; a v2
 * snapshot without the section means the friend did not share that group.
 */
export function rowAchievements(
  snapshot: LeaderboardSnapshot,
  year: number | null
): Pick<LeaderboardRow, "achievements" | "achievementsUnavailable"> {
  if (year !== null) return { achievementsUnavailable: "yearView" };
  if (snapshot.version === 1) return { achievementsUnavailable: "olderServer" };
  return snapshot.achievements
    ? { achievements: snapshot.achievements }
    : { achievementsUnavailable: "notShared" };
}

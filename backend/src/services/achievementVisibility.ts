import type { DomainKey } from "../shared/domains";
import { loadVisibleDomains } from "./domainVisibility";
import { SHARED_BADGE_DOMAINS } from "../data/achievementSeeds/partL";
import { TRAVTRACK_BADGE_CODES } from "../data/achievementSeeds/partN";
import { providerIs } from "./locationProvider/provider";

/**
 * Which achievements a user may see, count and score — the ONE rule, applied
 * by every route that lists or sums badges (acceptance D4, 2026-09-26: with
 * the beta switch off the achievements page read "75 of 275" while its points,
 * "6,200", still carried the hidden rail badges, and the statistics overview
 * counted 81).
 *
 * A badge of a domain the user does not see — switched off, or behind the
 * instance's beta switch (roadtrip, tour) — stays in the database (it was earned and is kept),
 * but it is neither listed nor counted nor scored until the domain is visible.
 * `shared` badges belong to no domain and are visible — unless only
 * some domains can earn them (`SHARED_BADGE_DOMAINS`, forgejo#265): such a badge
 * shows while at least one of its domains does, so the trophy case never
 * offers a badge nobody on the instance can reach. The TravTrack badges
 * (`TRAVTRACK_BADGE_CODES`, forgejo#400) are shown while TravTrack is the
 * account's working location source and nowhere else — a leaderboard row, which
 * cannot ask, hides them.
 */
export type AchievementVisibility = (domain: string, code?: string) => boolean;

export function achievementVisibility(
  visible: readonly DomainKey[],
  /** TravTrack is this account's working location source; omitted reads as hidden. */
  travTrackVisible = false
): AchievementVisibility {
  const keys = new Set<string>(visible);
  return (domain, code) => {
    if (domain !== "shared") return keys.has(domain);
    if (code !== undefined && TRAVTRACK_BADGE_CODES.has(code)) return travTrackVisible;
    const needs = code === undefined ? undefined : SHARED_BADGE_DOMAINS[code];
    return needs === undefined || needs.some((d) => keys.has(d));
  };
}

/** The rule for a stored user, from their domain toggles and the beta switch. */
export async function loadAchievementVisibility(userId: string): Promise<AchievementVisibility> {
  const [visible, travTrack] = await Promise.all([
    loadVisibleDomains(userId),
    providerIs(userId, "travtrack"),
  ]);
  return achievementVisibility(visible, travTrack);
}

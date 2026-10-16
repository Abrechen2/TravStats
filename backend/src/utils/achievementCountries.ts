import { loadVisibleDomains } from "../services/domainVisibility";
import { loadPassport, type PassportSources } from "../services/stats/passportLoader";

/**
 * The sources the country badges read — exported so the badge's EVIDENCE
 * (`services/evidence/badges/badgeEvidence.ts`) lists exactly the records the
 * badge set was counted from, and not a hidden domain's rides beside them.
 * A confirmed place counts (forgejo#299 supersedes the 2026-09-26 "a place
 * never moves a badge" rule); location history never does.
 */
export async function badgePassportSources(userId: string): Promise<PassportSources> {
  const visible = new Set(await loadVisibleDomains(userId));
  return {
    rail: visible.has("rail"),
    bus: visible.has("bus"),
    roadtrip: visible.has("roadtrip"),
    track: false,
  };
}

/**
 * Country badges use the passport's confirmed visits (forgejo#299).
 * A confirmed place counts; a transit or raw location observation does not.
 * Legacy union-only countries cannot bypass this evidence requirement.
 * Optional beta domains still respect their visibility gates.
 */
export async function achievementCountries(
  userId: string,
  _unionFloor: ReadonlySet<string>
): Promise<Set<string>> {
  const passport = await loadPassport(userId, undefined, await badgePassportSources(userId));
  return new Set(passport.countries.filter((c) => c.counted).map((c) => c.code));
}

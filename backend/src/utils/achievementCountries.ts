import { loadVisibleDomains } from "../services/domainVisibility";
import { loadPassport, type PassportSources } from "../services/stats/passportLoader";
import { groundContinents } from "./achievementContinents";

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
    ferry: visible.has("ferry"),
    roadtrip: visible.has("roadtrip"),
    track: false,
  };
}

/** The ground-contact set the country and continent badges count. */
export interface AchievementGeography {
  countries: Set<string>;
  continents: Set<string>;
}

/**
 * Country and continent badges read the passport's GROUND-CONTACT set
 * (forgejo#299; owner ruling 2026-08-09, "count every country set foot in"):
 * every passport row — connections, drive-throughs and open chain ends
 * included, the user's overrides applied. "Land besucht" is the passport's
 * stricter headline and is not what a badge counts.
 *
 * What keeps a phantom out is the passport itself: raw location history is
 * never a row (`track: false` here, and the passport refuses it as proof
 * anyway), so the single Syria point earns no country and no continent.
 *
 * Continents are placed per piece of ground evidence, not per row
 * (`groundContinents`): Vladivostok after Moscow keeps Asia, and a flown
 * airport the catalogue has no country for still proves its continent.
 */
export async function achievementGeography(userId: string): Promise<AchievementGeography> {
  const sources = await badgePassportSources(userId);
  const passport = await loadPassport(userId, undefined, sources);
  const ground = passport.countries.filter((c) => c.groundPresence);
  return {
    countries: new Set(ground.map((c) => c.code)),
    continents: await groundContinents(userId, ground, sources),
  };
}

/** The badge country set — `achievementGeography(...).countries`. The floor is not read. */
export async function achievementCountries(
  userId: string,
  _unionFloor: ReadonlySet<string>
): Promise<Set<string>> {
  return (await achievementGeography(userId)).countries;
}

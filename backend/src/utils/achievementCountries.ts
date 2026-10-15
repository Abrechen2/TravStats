import { loadVisibleDomains } from "../services/domainVisibility";
import { loadPassport } from "../services/stats/passportLoader";

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
  const visible = new Set(await loadVisibleDomains(userId));
  const passport = await loadPassport(userId, undefined, {
    rail: visible.has("rail"),
    bus: visible.has("bus"),
    roadtrip: visible.has("roadtrip"),
    track: false,
  });
  return new Set(passport.countries.filter((c) => c.counted).map((c) => c.code));
}

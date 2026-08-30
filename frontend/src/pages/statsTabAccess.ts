import type { DomainKey } from "../shared/domains";
import type { PlacesAccess } from "../hooks/usePlacesVisible";

export type StatsTab = DomainKey | "all";

/**
 * Which statistics tab may actually be drawn.
 *
 * The tab STRIP is built from the user's enabled domains, so a switched-off
 * domain has no button. The filter itself was read straight out of `?tab=`
 * with no such check — so `/stats?tab=poi` drew the POI statistics for an
 * account that had turned the domain off, and on an instance where the beta
 * flag was off entirely. Gated chrome, ungated deep link.
 *
 * Split out as a pure function rather than left inline because the rule has
 * three inputs and a state that is neither yes nor no, and that is exactly the
 * kind of thing that gets a fourth case bolted on inside a 900-line component
 * where nobody can see it.
 *
 * POI is asked differently on purpose: `usePlacesAccess` already answers BOTH
 * halves — does the instance allow the domain, and does this user want it — so
 * passing `enabled` for it as well would be asking the same question twice and
 * inviting the two to drift apart. Its third state matters:
 * `betaFeaturesEnabled` is instance state that is deliberately never persisted,
 * so it is `null` until `GET /settings` answers. Reading that "don't know yet"
 * as "no" is precisely what used to bounce people off /places on a hard reload.
 */
export function resolveStatsTab(
  requested: StatsTab,
  enabledDomains: readonly DomainKey[],
  placesAccess: PlacesAccess
): StatsTab {
  if (requested === "all") return "all";
  if (requested === "poi") return placesAccess === "denied" ? "all" : "poi";
  // Falling back to the overview rather than showing nothing: the reader asked
  // for statistics, and a page they can use beats an empty panel.
  return enabledDomains.includes(requested) ? requested : "all";
}

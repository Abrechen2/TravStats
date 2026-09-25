import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";
import type { PlacesAccess } from "../hooks/usePlacesVisible";

export type StatsTab = DomainKey | "all";

/**
 * `?tab=` read into a tab — any registered domain, else the overview. Whether
 * that tab may be DRAWN is `resolveStatsTab`'s question, not this one's.
 *
 * It used to be two hand-written lists of four domains in the page, one for
 * the first render and one for the URL sync. Rail was on neither, so clicking
 * its tab wrote `?tab=rail` and the sync effect at once reset it to the
 * overview — found in the production-bundle check of 2026-09-25.
 */
export function parseStatsTab(tab: string | null): StatsTab {
  return (DOMAIN_KEYS as readonly string[]).includes(tab ?? "") ? (tab as DomainKey) : "all";
}

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
/**
 * Which domain tabs the strip draws. The same rule as `resolveStatsTab`, on
 * the other side of the URL: on 2026-09-05 the strip still offered "POI /
 * Besuche" on an instance with the beta flag off, because it was built from
 * `enabled` alone while the deep link had already learned to ask
 * `usePlacesAccess`. Pending keeps the tab (the app does not know yet);
 * denied removes it.
 *
 * Rail asks the INSTANCE half separately (`railOffered`, the `railDomain` beta
 * gate — `useRailOffered`); `enabledDomains` already carries the user half. It
 * defaults to hidden, so a caller that forgets to pass it hides rail rather
 * than showing a beta domain on an instance that switched it off.
 */
export function visibleStatsTabs(
  enabledDomains: readonly DomainKey[],
  placesAccess: PlacesAccess,
  railOffered = false
): DomainKey[] {
  return enabledDomains.filter(
    (key) => (key !== "poi" || placesAccess !== "denied") && (key !== "rail" || railOffered)
  );
}

export function resolveStatsTab(
  requested: StatsTab,
  enabledDomains: readonly DomainKey[],
  placesAccess: PlacesAccess,
  railOffered = false
): StatsTab {
  if (requested === "all") return "all";
  if (requested === "poi") return placesAccess === "denied" ? "all" : "poi";
  // Rail behind a closed beta gate has no tab to land on, however it was asked.
  if (requested === "rail" && !railOffered) return "all";
  // Falling back to the overview rather than showing nothing: the reader asked
  // for statistics, and a page they can use beats an empty panel.
  return enabledDomains.includes(requested) ? requested : "all";
}

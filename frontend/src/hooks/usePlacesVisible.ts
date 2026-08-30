import { useBetaFeatureAccess } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether the Places (POI) domain may be shown at all.
 *
 * TWO independent conditions, and they answer different questions:
 *
 *   - `isEnabled("poi")`            — does THIS USER want the domain?
 *   - `isFeatureVisible("poiDomain")` — is the INSTANCE allowed to show it?
 *
 * Both must hold. They are combined here rather than at each call site because
 * there are six of them (nav, dashboard tab, dashboard counts, /places route,
 * the module toggle, the trip timeline) and a rule spread over six files is a
 * rule that will be applied five times after the next change. The registry
 * comment in config/betaFeatures.ts makes the same argument about bare
 * booleans, and this is the same failure one level up.
 *
 * VISIBILITY ONLY. `/api/v1/places` stays reachable for any authenticated
 * user whatever this returns — the beta flag is not an authorisation check,
 * and treating it as one would be the bug, not the feature. It also means a
 * user's places survive the flag being turned off: the rows are untouched and
 * reappear when it comes back on.
 */
export function usePlacesVisible(): boolean {
  return usePlacesAccess() === "allowed";
}

/**
 * The same rule as a THREE-state answer, for callers that must not treat
 * "don't know yet" as "no".
 *
 * `betaFeaturesEnabled` is instance state and is deliberately never persisted
 * to localStorage (see the `partialize` in store/settingsStore.ts), so on a
 * cold load it is `null` until `GET /settings` answers. `enabledDomains` IS
 * persisted, which is why the other domains' routes survive a refresh and this
 * one did not: a hard navigation to /places evaluated the guard while the flag
 * was still unknown and redirected to the dashboard. Bookmarking the page,
 * hitting reload on it, or opening a place link in a new tab all bounced.
 * Found by driving a browser; every unit test passed throughout.
 *
 * So: hiding CHROME fails closed (a tab must never flash into view and then
 * vanish — that is what `usePlacesVisible` is for), while a ROUTE waits.
 * Redirecting on "unknown" throws the user off a page they asked for; showing
 * a spinner for one request costs nothing and cannot be wrong.
 */
export type PlacesAccess = "pending" | "allowed" | "denied";

export function usePlacesAccess(): PlacesAccess {
  const { isEnabled } = useEnabledDomains();
  // The pending/allowed/denied rule itself lives in useBetaFeatures now — a
  // second gated route needed the same three states, and the argument this
  // file makes about a rule spread over six call sites applies to the rule
  // itself just as much.
  const gate = useBetaFeatureAccess("poiDomain");
  if (gate === "pending") return "pending";
  return isEnabled("poi") && gate === "allowed" ? "allowed" : "denied";
}

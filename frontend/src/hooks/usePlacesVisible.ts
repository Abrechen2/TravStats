import { useBetaFeatures } from "./useBetaFeatures";
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
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();
  return isEnabled("poi") && isFeatureVisible("poiDomain");
}

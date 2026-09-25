import { useBetaFeatures } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether the rail domain may be shown — the one home of the rule (spec
 * docs/superpowers/specs/2026-09-25-rail-domain.md).
 *
 * TWO conditions, the shape Places had until 2026-09-05: the INSTANCE allows
 * it (`railDomain` beta gate) and THIS USER wants it (`enabledDomains`). Nav,
 * logbook tabs, the colour settings and the route guard all ask here, so the
 * day the gate comes off is one edit in this file rather than five.
 *
 * VISIBILITY ONLY. `/api/v1/rail` stays reachable whatever this returns, and a
 * user's journeys survive the flag or the domain being switched off.
 */
export function useRailVisible(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  return isFeatureVisible("railDomain") && isEnabled("rail");
}

/**
 * The instance half alone — for the places where a user switches the domain
 * ON (settings modules, setup). Gating those on "already enabled" too would
 * make the switch unreachable.
 */
export function useRailOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("railDomain");
}

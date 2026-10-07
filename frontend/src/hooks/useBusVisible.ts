import { useBetaFeatures } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether the bus domain may be shown — the one home of the rule (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md §11).
 *
 * TWO conditions, as rail and rental: the INSTANCE allows it (`busDomain` beta
 * gate) and THIS USER wants it (`enabledDomains`). VISIBILITY ONLY —
 * `/api/v1/bus` stays reachable, and a user's rides survive the flag or the
 * domain being switched off.
 */
export function useBusVisible(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  return isFeatureVisible("busDomain") && isEnabled("bus");
}

/**
 * The instance half alone — for the places where a user switches the domain
 * ON (settings modules, setup). Gating those on "already enabled" too would
 * make the switch unreachable.
 */
export function useBusOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("busDomain");
}

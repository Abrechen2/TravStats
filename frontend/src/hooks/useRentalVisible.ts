import { useBetaFeatures } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether the rental domain may be shown — the one home of the rule (spec
 * docs/superpowers/specs/2026-10-01-rental-domain-design.md §6, §9).
 *
 * TWO conditions, as rail: the INSTANCE allows it (`rentalDomain` beta gate)
 * and THIS USER wants it (`enabledDomains`). VISIBILITY ONLY — `/api/v1/rentals`
 * stays reachable, and a user's rentals survive the flag being switched off.
 */
export function useRentalVisible(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  return isFeatureVisible("rentalDomain") && isEnabled("rental");
}

/**
 * The instance half alone — for the places where a user switches the domain
 * ON (settings modules, setup). Gating those on "already enabled" too would
 * make the switch unreachable.
 */
export function useRentalOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("rentalDomain");
}

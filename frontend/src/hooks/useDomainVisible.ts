import { isDomainOffered } from "../config/domainBetaGates";
import type { DomainKey } from "../shared/domains";
import { useBetaFeatures } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether a domain may be shown: the instance allows it (its beta switch in
 * `DOMAIN_BETA_GATES`, if it has one) AND this user wants it. Both halves are
 * applied by `useEnabledDomains`; this is the single-domain question.
 *
 * VISIBILITY ONLY — the domain's API stays reachable, and a user's entries
 * survive the switch or the domain being turned off.
 */
export function useDomainVisible(key: DomainKey): boolean {
  return useEnabledDomains().isEnabled(key);
}

/**
 * The instance half alone — for the places where a user switches the domain
 * ON (settings modules, setup). Gating those on "already enabled" too would
 * make the switch unreachable.
 */
export function useDomainOffered(key: DomainKey): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isDomainOffered(key, isFeatureVisible);
}

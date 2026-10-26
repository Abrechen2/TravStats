import type { DomainKey } from "../shared/domains";
import type { BetaFeatureKey } from "./betaFeatures";

/**
 * The beta switch each gated domain sits behind — the one list of them.
 *
 * `useEnabledDomains` drops a domain whose switch is closed, so every surface
 * that asks it (nav, logbook tabs, dashboard, statistics, achievements, trips)
 * is gated by this map. Before it, roadtrip and ferry were dropped there while
 * rail, rental and bus each had a hook of their own, and every surface
 * hand-rolled which of the five to ask — a new domain gated in one place and
 * forgotten in the next. Taking a domain out of beta is deleting its line here
 * (and its registry entry); a domain absent from this map is never gated.
 */
export const DOMAIN_BETA_GATES: Readonly<Partial<Record<DomainKey, BetaFeatureKey>>> =
  Object.freeze({
    roadtrip: "roadtrips",
  });

/** Whether the instance allows `key` at all — true for a domain no switch gates. */
export function isDomainOffered(
  key: DomainKey,
  isFeatureVisible: (feature: BetaFeatureKey) => boolean
): boolean {
  const gate = DOMAIN_BETA_GATES[key];
  return gate === undefined || isFeatureVisible(gate);
}

/**
 * Whether an entry the server sent for `domain` may be drawn. The server answers
 * by the user's own domain choice and knows nothing of the instance's beta
 * switches (owner rule 2026-09-25), so a gated domain's entries are dropped
 * here — until this asked the map, only rail and rental were, and a bus or
 * ferry departure showed under "Als Nächstes" on an instance without either.
 */
export function isEntryDomainShown(
  domain: DomainKey | "trip",
  isEnabled: (key: DomainKey) => boolean
): boolean {
  return domain === "trip" || DOMAIN_BETA_GATES[domain] === undefined || isEnabled(domain);
}

/**
 * The domains a settings or setup list offers as a switch. A gated domain is
 * offered while its beta switch is open, and stays listed while the user has it
 * on even with the switch closed, so it can always be switched off again.
 * Roadtrips are the exception kept from before this map: listed only while
 * their switch is open.
 */
export function switchableDomains(
  keys: readonly DomainKey[],
  stored: readonly DomainKey[],
  isFeatureVisible: (feature: BetaFeatureKey) => boolean
): DomainKey[] {
  return keys.filter(
    (key) => isDomainOffered(key, isFeatureVisible) || (key !== "roadtrip" && stored.includes(key))
  );
}

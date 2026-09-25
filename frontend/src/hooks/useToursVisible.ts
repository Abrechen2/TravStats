import { useBetaFeatureAccess, useBetaFeatures, type BetaFeatureAccess } from "./useBetaFeatures";

/**
 * Whether day tours may be shown at all (owner, 2026-09-24): tours sit behind
 * the same beta key as roadtrips, `roadtrips`, because the two are one feature
 * under review — the key's own entry in `config/betaFeatures.ts` names both —
 * and one switch lets them in or out together.
 *
 * Roadtrips need no such hook: they are a domain, and `useEnabledDomains`
 * already drops `roadtrip` while the key is closed. Tours are not a domain,
 * so every surface that shows one asks this instead. Removing the gate means
 * deleting this file and every call to it, as the registry asks.
 */
export function useToursVisible(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("roadtrips");
}

/** Three-state for route guards: `pending` while the instance flag is unknown. */
export function useToursAccess(): BetaFeatureAccess {
  return useBetaFeatureAccess("roadtrips");
}

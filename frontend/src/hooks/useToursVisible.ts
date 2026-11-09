import { useSettingsStore } from "../store/settingsStore";
import { useBetaFeatureAccess, useBetaFeatures, type BetaFeatureAccess } from "./useBetaFeatures";

/**
 * Whether day tours may be shown at all: `tour` is a domain since 2026-11-09, so
 * the user's switch AND the instance's beta key (`roadtrips`, shared with
 * roadtrips — the key's entry in `config/betaFeatures.ts` names both) must be
 * open — the same two conditions `useEnabledDomains` applies to a gated domain
 * (`DOMAIN_BETA_GATES`); this stays as the one name the tour surfaces ask, until T2 folds them into the
 * domain gate. Removing the beta gate means deleting its registry entries and
 * every `isFeatureVisible("roadtrips")` call, as the registry asks.
 */
export function useToursVisible(): boolean {
  const stored = useSettingsStore((s) => s.enabledDomains);
  const { isFeatureVisible } = useBetaFeatures();
  return (stored ?? []).includes("tour") && isFeatureVisible("roadtrips");
}

/** Three-state for route guards: `pending` while the instance flag is unknown. */
export function useToursAccess(): BetaFeatureAccess {
  return useBetaFeatureAccess("roadtrips");
}

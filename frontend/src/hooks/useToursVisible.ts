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

/**
 * Three-state for route guards: `pending` while the instance flag or the user's
 * settings are still unknown, `denied` when the beta key is closed or the user
 * switched tours off. Roadtrip surfaces that share the beta key but not the
 * domain ask `useBetaFeatureAccess("roadtrips")` themselves.
 */
export function useToursAccess(): BetaFeatureAccess {
  const beta = useBetaFeatureAccess("roadtrips");
  const stored = useSettingsStore((s) => s.enabledDomains);
  const loaded = useSettingsStore((s) => s.enabledDomainsLoaded);
  if (beta === "denied") return "denied";
  if (beta === "pending" || !loaded) return "pending";
  return (stored ?? []).includes("tour") ? "allowed" : "denied";
}

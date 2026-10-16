import { useCallback, useMemo } from "react";
import { useBetaFeatures } from "./useBetaFeatures";
import { useSettingsStore } from "../store/settingsStore";
import { isDomainOffered } from "../config/domainBetaGates";
import type { DomainKey } from "../shared/domains";

const NO_DOMAINS: DomainKey[] = [];

/** Returns the user's currently enabled domains + a helper checker.
 *
 * A domain behind a closed beta switch (`DOMAIN_BETA_GATES`) is not in the
 * list, whatever the user's own toggle says: every surface that shows a domain
 * asks this hook, so this is the whole gate. The stored choice is untouched —
 * the settings page reads it raw, so switching the beta off and on again does
 * not lose the user's domains.
 *
 * `isEnabled` is memoized against the `enabled` array so consumers can safely
 * place it in `useEffect` dependency arrays without triggering re-render
 * loops when the parent re-renders for unrelated reasons. */
export function useEnabledDomains(): {
  enabled: DomainKey[];
  isEnabled: (key: DomainKey) => boolean;
} {
  // `?? NO_DOMAINS`, a stable empty list: a store that has not hydrated the
  // field (and many page tests' stubs) must not crash every consumer.
  const stored = useSettingsStore((s) => s.enabledDomains) ?? NO_DOMAINS;
  const { isFeatureVisible } = useBetaFeatures();
  const enabled = useMemo(
    () => stored.filter((k) => isDomainOffered(k, isFeatureVisible)),
    [stored, isFeatureVisible]
  );
  const isEnabled = useCallback((key: DomainKey) => enabled.includes(key), [enabled]);
  return { enabled, isEnabled };
}

import { useCallback, useMemo } from "react";
import { useBetaFeatures } from "./useBetaFeatures";
import { useSettingsStore } from "../store/settingsStore";
import type { DomainKey } from "../shared/domains";

const NO_DOMAINS: DomainKey[] = [];

/** Returns the user's currently enabled domains + a helper checker.
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
  // Roadtrips are beta (2.7): while the instance switch is closed the domain
  // does not exist for this reader, whatever their own toggle says. Every
  // surface that shows a domain asks this hook, so this is the whole gate.
  const roadtripsOpen = isFeatureVisible("roadtrips");
  const enabled = useMemo(
    () => (roadtripsOpen ? stored : stored.filter((k) => k !== "roadtrip")),
    [stored, roadtripsOpen]
  );
  const isEnabled = useCallback((key: DomainKey) => enabled.includes(key), [enabled]);
  return { enabled, isEnabled };
}

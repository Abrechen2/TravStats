import { useCallback } from "react";
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
  const enabled = useSettingsStore((s) => s.enabledDomains) ?? NO_DOMAINS;
  const isEnabled = useCallback((key: DomainKey) => enabled.includes(key), [enabled]);
  return { enabled, isEnabled };
}

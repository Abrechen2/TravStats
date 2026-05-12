import { useCallback } from "react";
import { useSettingsStore } from "../store/settingsStore";
import type { DomainKey } from "../shared/domains";

/** Returns the user's currently enabled domains + a helper checker.
 *
 * `isEnabled` is memoized against the `enabled` array so consumers can safely
 * place it in `useEffect` dependency arrays without triggering re-render
 * loops when the parent re-renders for unrelated reasons. */
export function useEnabledDomains(): {
  enabled: DomainKey[];
  isEnabled: (key: DomainKey) => boolean;
} {
  const enabled = useSettingsStore((s) => s.enabledDomains);
  const isEnabled = useCallback((key: DomainKey) => enabled.includes(key), [enabled]);
  return { enabled, isEnabled };
}

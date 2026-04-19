import { useSettingsStore } from "../store/settingsStore";
import type { DomainKey } from "../shared/domains";

/** Returns the user's currently enabled domains + a helper checker. */
export function useEnabledDomains(): {
  enabled: DomainKey[];
  isEnabled: (key: DomainKey) => boolean;
} {
  const enabled = useSettingsStore((s) => s.enabledDomains);
  return {
    enabled,
    isEnabled: (key) => enabled.includes(key),
  };
}

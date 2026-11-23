import { useSettingsStore } from "../store/settingsStore";

/**
 * Whether day tours may be shown: `tour` is a domain since 2026-11-09, so this
 * is the user's own switch. The instance beta key they once shared with
 * roadtrips is gone (un-gated for 2.8, owner 2026-11-23).
 */
export function useToursVisible(): boolean {
  const stored = useSettingsStore((s) => s.enabledDomains);
  return (stored ?? []).includes("tour");
}

/**
 * Three-state for route guards: `pending` while the user's settings are still
 * unknown, `denied` when the user switched tours off.
 */
export function useToursAccess(): "pending" | "allowed" | "denied" {
  const stored = useSettingsStore((s) => s.enabledDomains);
  const loaded = useSettingsStore((s) => s.enabledDomainsLoaded);
  if (!loaded) return "pending";
  return (stored ?? []).includes("tour") ? "allowed" : "denied";
}

import { useSettingsStore } from "../store/settingsStore";

/**
 * How an airline is drawn in lists: the named brand tile (the proxy's "logo"
 * variant, a kiwi tile that carries the airline name) or the bare symbol (the
 * vendored "icon" variant). "tile" is the default and what every account
 * without the setting keeps seeing.
 */
export const AIRLINE_LOGO_STYLES = ["tile", "icon"] as const;
export type AirlineLogoStyle = (typeof AIRLINE_LOGO_STYLES)[number];

export const DEFAULT_AIRLINE_LOGO_STYLE: AirlineLogoStyle = "tile";

/** Persisted state from before the preference existed has none; an unknown string is ignored. */
export function resolveAirlineLogoStyle(style: string | null | undefined): AirlineLogoStyle {
  return (AIRLINE_LOGO_STYLES as readonly string[]).includes(style ?? "")
    ? (style as AirlineLogoStyle)
    : DEFAULT_AIRLINE_LOGO_STYLE;
}

export function useAirlineLogoStyle(): AirlineLogoStyle {
  return resolveAirlineLogoStyle(useSettingsStore((s) => s.units?.airlineLogoStyle));
}

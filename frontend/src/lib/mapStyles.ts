/** Shared online basemap selection. Keep IDs stable for saved preferences. */
export type VectorMapStyle = "standard" | "light" | "dark" | "voyager";
declare global {
  interface Window {
    __TRAVSTATS_MAP_CONFIG__?: { version: number; styles: Record<string, string> };
  }
}
const defaults = { standard: "liberty", light: "positron", dark: "dark", voyager: "bright" };
export function mapStyleUrl(id: VectorMapStyle): string {
  const config = typeof window === "undefined" ? undefined : window.__TRAVSTATS_MAP_CONFIG__;
  const custom = config?.version === 1 ? config.styles[id] : undefined;
  return custom || `https://tiles.openfreemap.org/styles/${defaults[id]}`;
}

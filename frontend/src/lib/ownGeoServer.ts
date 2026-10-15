import type { StyleSpecification } from "maplibre-gl";

declare global {
  interface Window {
    __TRAVSTATS_GEO__?: Readonly<{ mode: "pending" | "own" | "legacy" }>;
  }
}

/** The static bootstrap starts pending; a failed runtime request never selects a third party. */
export function usesOwnGeoServer(): boolean {
  return typeof window !== "undefined" && window.__TRAVSTATS_GEO__ !== undefined &&
    window.__TRAVSTATS_GEO__.mode !== "legacy";
}

export function ownMapStyle(id: string, legacy: string | StyleSpecification): string | StyleSpecification {
  if (!usesOwnGeoServer()) return legacy;
  const style = ["standard", "light", "dark", "voyager"].includes(id) ? id : "dark";
  return `/api/v1/geo-server/assets/styles/${style}/style.json`;
}

export function ownBasemapCatalogue<T extends { id: string; style?: string | StyleSpecification; url?: string | StyleSpecification }>(items: T[]): T[] {
  if (!usesOwnGeoServer()) return items;
  return items.filter(item => !["satellite", "osm"].includes(item.id)).map(item => ({
    ...item,
    ...(item.style !== undefined ? { style: ownMapStyle(item.id, item.style) } : {}),
    ...(item.url !== undefined ? { url: ownMapStyle(item.id, item.url) } : {}),
  }));
}

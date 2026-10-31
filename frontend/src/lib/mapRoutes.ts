import type { Layer } from "@deck.gl/core";

/**
 * "Show the map without its lines" (owner, 2026-10-31): every domain that draws
 * a route can have its lines switched off while its markers — airports, ports,
 * stations, stops — and their labels stay.
 *
 * The switch is a per-domain boolean in the account-synced `mapAppearance`
 * blob (`routesVisible`). Absent = drawn, so nobody's map changes until they
 * flip one. Rentals are not here: their one-way link already has its own
 * switch (`rentalShowLine`).
 */
export const ROUTE_DOMAINS = [
  "flight",
  "cruise",
  "rail",
  "bus",
  "ferry",
  "tour",
  "roadtrip",
] as const;
export type RouteDomain = (typeof ROUTE_DOMAINS)[number];
export type RoutesVisible = Record<RouteDomain, boolean>;

export const ALL_ROUTES_VISIBLE: RoutesVisible = {
  flight: true,
  cruise: true,
  rail: true,
  bus: true,
  ferry: true,
  tour: true,
  roadtrip: true,
};

/** The stored record, defaulted per domain: anything but an explicit `false` is drawn. */
export function routesVisibleFromStored(stored: unknown): RoutesVisible {
  const raw =
    typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const out = { ...ALL_ROUTES_VISIBLE };
  for (const domain of ROUTE_DOMAINS) if (raw[domain] === false) out[domain] = false;
  return out;
}

/**
 * Which domain's LINE a deck.gl layer id is, or null for a marker, a label or
 * anything that is not a route. Ids are the contract: every line builder names
 * its line layers `…-paths` / `routes-arc*` / `cruise-arc*` / `globe-*-arcs|paths`
 * and its markers otherwise (`…-stations`, `…-terminals`, `routes-dot`).
 */
export function routeDomainOfLayerId(id: string): RouteDomain | null {
  if (
    /^routes-(arc|path|recorded)/.test(id) ||
    /^globe-flight-(arcs|head$)/.test(id) ||
    /^special-flights-(arc|loop)/.test(id)
  )
    return "flight";
  if (/^cruise-arc/.test(id) || id === "globe-cruise-paths") return "cruise";
  if (id === "dashboard-tour-paths") return null; // split by datum, see `useTourDeckLayers`
  if (/-paths$/.test(id)) {
    if (/rail/.test(id)) return "rail";
    if (/bus/.test(id)) return "bus";
    if (/ferry/.test(id)) return "ferry";
  }
  return null;
}

/** The layers without the lines of every domain the user switched off. */
export function withoutHiddenRoutes<L extends Layer>(
  layers: readonly L[],
  visible: RoutesVisible
): L[] {
  if (ROUTE_DOMAINS.every((d) => visible[d])) return [...layers];
  return layers.filter((layer) => {
    const domain = typeof layer?.id === "string" ? routeDomainOfLayerId(layer.id) : null;
    return domain === null || visible[domain];
  });
}

/**
 * Why a mode cannot do without its routes, or null. The switch is disabled
 * there with this reason (a key under `map:globe.panel.routesBlocked.*`)
 * rather than leaving an empty map: the journey view is a trip's route, the
 * trips mode animates the flights, and the day-tour tab has no marker at all.
 */
export function routesBlockedReason(
  tab: string,
  mode: string
): "journey" | "trips" | "tour" | null {
  if (mode === "journey") return "journey";
  if (mode === "trips") return "trips";
  if (tab === "tour") return "tour";
  return null;
}

/**
 * Deep link into the map panel: `/dashboard?panel=routes` opens the panel with
 * the per-domain "Routen" switches in view (Settings › Ansichten links here).
 * Read when the panel mounts, never written back, so it opens once per visit.
 */
export const MAP_PANEL_PARAM = "panel";
export const MAP_PANEL_ROUTES = "routes";

export function mapPanelRoutesRequested(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get(MAP_PANEL_PARAM) === MAP_PANEL_ROUTES;
  } catch {
    return false;
  }
}

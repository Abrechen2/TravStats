export const DASHBOARD_TABS = ["all", "flight", "cruise", "poi", "lodging"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const ALL_MODES = ["overview", "heatmap", "journey", "globe"] as const;
export type AllMode = (typeof ALL_MODES)[number];

export const FLIGHT_MODES = ["routes", "heatmap", "stats-map", "trips", "globe"] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const CRUISE_MODES = ["sea-routes", "itinerary", "port-frequency", "globe"] as const;
export type CruiseMode = (typeof CRUISE_MODES)[number];

export const POI_MODES = ["markers", "heatmap"] as const;
export type PoiMode = (typeof POI_MODES)[number];

// `globe` is a PROJECTION, not a data view — it only says "show me the same
// thing on a sphere". Flights and cruises offered it, lodging did not, even
// though the map component has always been able to draw hotel pins that way;
// LodgingTab simply passed a hardcoded "routes" through. That was an
// oversight, not a decision.
export const LODGING_MODES = ["map", "nights", "chains", "globe"] as const;
export type LodgingMode = (typeof LODGING_MODES)[number];

export type DashboardMode = AllMode | FlightMode | CruiseMode | PoiMode | LodgingMode;

interface TabRegistryEntry<M extends DashboardMode> {
  readonly modes: readonly M[];
  readonly default: M;
}

export const TAB_MODE_REGISTRY = {
  all: { modes: ALL_MODES, default: "overview" },
  flight: { modes: FLIGHT_MODES, default: "routes" },
  cruise: { modes: CRUISE_MODES, default: "sea-routes" },
  poi: { modes: POI_MODES, default: "markers" },
  lodging: { modes: LODGING_MODES, default: "map" },
} as const satisfies Record<DashboardTab, TabRegistryEntry<DashboardMode>>;

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === "string" && (DASHBOARD_TABS as readonly string[]).includes(value);
}

export function isModeForTab(tab: DashboardTab, mode: unknown): mode is DashboardMode {
  if (typeof mode !== "string") return false;
  return (TAB_MODE_REGISTRY[tab].modes as readonly string[]).includes(mode);
}

export function defaultModeForTab(tab: DashboardTab): DashboardMode {
  return TAB_MODE_REGISTRY[tab].default;
}

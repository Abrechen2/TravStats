import { webgl2Available } from "../lib/webgl2";

export const DASHBOARD_TABS = [
  "all",
  "flight",
  "cruise",
  "poi",
  "lodging",
  "roadtrip",
  "tour",
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const ALL_MODES = ["overview", "heatmap", "journey", "globe"] as const;
export type AllMode = (typeof ALL_MODES)[number];

export const FLIGHT_MODES = ["routes", "heatmap", "stats-map", "trips", "globe"] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const CRUISE_MODES = ["sea-routes", "itinerary", "port-frequency", "globe"] as const;
export type CruiseMode = (typeof CRUISE_MODES)[number];

// Places were the last domain tab without the sphere, for the same reason
// lodging was: nothing decided against it, the tab simply passed a hardcoded
// "routes" through. Added 2026-09-20 together with the globe's place pins —
// offering a mode whose map draws nothing would have been the worse half.
export const POI_MODES = ["markers", "heatmap", "globe"] as const;
export type PoiMode = (typeof POI_MODES)[number];

// `globe` is a PROJECTION, not a data view — it only says "show me the same
// thing on a sphere". Flights and cruises offered it, lodging did not, even
// though the map component has always been able to draw hotel pins that way;
// LodgingTab simply passed a hardcoded "routes" through. That was an
// oversight, not a decision.
export const LODGING_MODES = ["map", "nights", "chains", "globe"] as const;
export type LodgingMode = (typeof LODGING_MODES)[number];

// Tours have no domain pill of their own (see the "Alle" tab's tour layer),
// so the dedicated tab keeps the same two views every other tab's "globe"
// mode offers: the flat map ("routes") and the sphere projection of the
// same lines.
export const TOUR_MODES = ["routes", "globe"] as const;
export type TourMode = (typeof TOUR_MODES)[number];

export type DashboardMode = AllMode | FlightMode | CruiseMode | PoiMode | LodgingMode | TourMode;

interface TabRegistryEntry<M extends DashboardMode> {
  readonly modes: readonly M[];
  readonly default: M;
  /**
   * What the tab opens on where the device cannot draw a globe. Each is the
   * default this tab had before the 2026-09-20 ruling.
   */
  readonly flatDefault: M;
}

/**
 * Every tab that has a globe opens on it.
 *
 * Owner ruling, 2026-09-20, from the globe's click card and the flat map's
 * side by side: "Globus soll ueberall genutzt werden". A default is the only
 * thing that makes that true for a reader who never opens the mode menu — and
 * it is only a default: `useDashboardRoute` prefers the URL, then what the
 * reader last chose for that tab, and reaches this table last.
 *
 * There is no exception left: `poi` gained its globe on the same day (see
 * POI_MODES above), so every tab in the table opens on the sphere.
 *
 * `flatDefault` is the device's exception rather than the tab's — see
 * `defaultModeForTab`.
 */
export const TAB_MODE_REGISTRY = {
  all: { modes: ALL_MODES, default: "globe", flatDefault: "overview" },
  flight: { modes: FLIGHT_MODES, default: "globe", flatDefault: "routes" },
  cruise: { modes: CRUISE_MODES, default: "globe", flatDefault: "sea-routes" },
  poi: { modes: POI_MODES, default: "globe", flatDefault: "markers" },
  lodging: { modes: LODGING_MODES, default: "globe", flatDefault: "map" },
  tour: { modes: TOUR_MODES, default: "globe", flatDefault: "routes" },
  // Roadtrips (2.7) draw the same kind of line a tour does, so they take the
  // tour's two modes — the globe first, like every tab.
  roadtrip: { modes: TOUR_MODES, default: "globe", flatDefault: "routes" },
} as const satisfies Record<DashboardTab, TabRegistryEntry<DashboardMode>>;

/**
 * Which projection a mode implies, or `null` when it says nothing about one.
 *
 * "journey" is the only `null`: it is a VIEW of one trip, drawable on either
 * projection, so selecting it must not overwrite the reader's last projection
 * choice — otherwise the journey view could never honour it.
 */
export function projectionOfMode(mode: DashboardMode): "globe" | "flat" | null {
  if (mode === "globe") return "globe";
  if (mode === "journey") return null;
  return "flat";
}

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === "string" && (DASHBOARD_TABS as readonly string[]).includes(value);
}

export function isModeForTab(tab: DashboardTab, mode: unknown): mode is DashboardMode {
  if (typeof mode !== "string") return false;
  return (TAB_MODE_REGISTRY[tab].modes as readonly string[]).includes(mode);
}

/**
 * What a tab opens on when the reader has never said otherwise.
 *
 * The globe — unless the device cannot draw one. `liteMode` is dataset-driven
 * and `webgl2Available` was consulted by the FLAT map alone, which is the only
 * surface with a fallback for a "no" (`NativeRoutesLayer` plus a notice). So
 * after the ruling a device without WebGL2 landed on a globe that cannot draw
 * at all, with no fallback and nothing saying why; it used to land on `routes`
 * and see the notice.
 *
 * `hasWebgl2` is a parameter so the rule can be tested both ways — the probe
 * itself answers once at import and never changes for the life of the page.
 */
export function defaultModeForTab(
  tab: DashboardTab,
  hasWebgl2: boolean = webgl2Available
): DashboardMode {
  const entry = TAB_MODE_REGISTRY[tab];
  return hasWebgl2 ? entry.default : entry.flatDefault;
}

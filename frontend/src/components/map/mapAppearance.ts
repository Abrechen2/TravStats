// One shared appearance store for BOTH maps — the flat 2D map and the globe.
//
// Previously each map kept its own localStorage blob, so tuning the look on
// the globe didn't carry over to the 2D map (and vice versa). The data model
// is now identical across both (preset enums, nullable RGB colours, one
// basemap id set), so a single blob lets the settings persist across the
// 2D ↔ 3D switch and across dashboard modes.
//
// Map-specific chrome that has no 2D↔3D meaning (globe auto-rotation, day/
// night, performance mode) stays out of here — those live per map.

import type { RouteWidth, MarkerSize } from "./controlPanelKit";
import type { LabelsMode } from "./labelPriority";

/** The 6 tokenless basemaps — same id set on the globe and the flat map. */
export type BasemapId = "standard" | "light" | "dark" | "voyager" | "satellite" | "osm";

export interface MapAppearance {
  styleId?: BasemapId;
  // Flight domain
  routeColor?: [number, number, number] | null;
  flightRouteWidth?: RouteWidth;
  airportColor?: [number, number, number] | null;
  flightMarkerSize?: MarkerSize;
  // Cruise domain
  cruiseRouteColor?: [number, number, number] | null;
  cruiseRouteWidth?: RouteWidth;
  portColor?: [number, number, number] | null;
  cruiseMarkerSize?: MarkerSize;
  // Layers
  showTerrain?: boolean;
  showPlaceLabels?: boolean;
  labelsMode?: LabelsMode;
}

const KEY = "mapAppearance.v2";

export function loadMapAppearance(): MapAppearance {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MapAppearance) : {};
  } catch {
    return {};
  }
}

/** Merge-write: only the given keys change, the rest of the blob is kept. */
export function saveMapAppearance(patch: MapAppearance): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...loadMapAppearance(), ...patch };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode) — persistence is opt-in.
  }
}

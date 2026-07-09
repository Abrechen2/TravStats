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
// Pre-consolidation blobs — migrated once into the shared key so existing
// users keep their customised look after the switch.
const LEGACY_GLOBE = "globeAppearance.v1";
const LEGACY_FLAT = "flatMapAppearance.v1";

function readBlob(key: string): MapAppearance & { markerColor?: [number, number, number] | null } {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Merge the old split blobs. The flat map called the airport colour
// `markerColor`; map it onto the shared `airportColor`. Flat wins on overlap
// (it also carried the basemap id).
function migrateLegacy(): MapAppearance {
  const globe = readBlob(LEGACY_GLOBE);
  const flat = readBlob(LEGACY_FLAT);
  const { markerColor, ...flatRest } = flat;
  const merged: MapAppearance = { ...globe, ...flatRest };
  const airportColor = markerColor ?? globe.airportColor;
  if (airportColor !== undefined) merged.airportColor = airportColor;
  return merged;
}

export function loadMapAppearance(): MapAppearance {
  if (typeof window === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return {};
  }
  if (raw) {
    try {
      return JSON.parse(raw) as MapAppearance;
    } catch {
      return {};
    }
  }
  // No shared blob yet — pull the legacy settings across one time.
  const migrated = migrateLegacy();
  if (Object.keys(migrated).length > 0) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(migrated));
    } catch {
      // localStorage unavailable — persistence is opt-in.
    }
  }
  return migrated;
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

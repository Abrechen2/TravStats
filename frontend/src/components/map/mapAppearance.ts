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

import type { LabelsMode } from "./labelPriority";
import {
  cruiseColorFromStored,
  type CruiseColorConfig,
  type CruiseColorMode,
  type CruiseColors,
} from "../../lib/cruiseColor";
import {
  lodgingColorFromStored,
  type LodgingColorConfig,
  type LodgingColorMode,
  type LodgingColors,
} from "../../lib/lodgingColor";
import {
  flightColorFromStored,
  type FlightColorConfig,
  type FlightColorMode,
  type FlightColors,
} from "../../lib/flightColor";
import {
  placeColorFromStored,
  type PlaceColorConfig,
  type PlaceColorMode,
  type PlaceColors,
} from "../../lib/placeColor";
import { flightRouteShapeFromStored, type FlightRouteShape } from "../../lib/flightRouteShape";

/** The 6 tokenless basemaps — same id set on the globe and the flat map. */
export type BasemapId = "standard" | "light" | "dark" | "voyager" | "satellite" | "osm";

export interface MapAppearance {
  styleId?: BasemapId;
  // Flight domain
  /** How flight routes are coloured + the user's colour per slot. Owned by
   *  `store/flightColorStore.ts`; both maps and the dashboard legend read it
   *  from there so they can never disagree. */
  flightColorMode?: FlightColorMode;
  flightColors?: FlightColors;
  /**
   * @deprecated Pre-mode single colour override (null = frequency heatmap).
   * Still READ once, to migrate an existing user forward into
   * `flightColorMode` (see `flightColorFromStored`); never written again.
   */
  routeColor?: [number, number, number] | null;
  /** How flight routes are DRAWN on the flat map (#183): 3D arcs (default) or
   *  flat on the map surface like cruise routes. Flat-map-only — the globe
   *  ignores it, so it is deliberately absent from the globe control panel. */
  flightRouteShape?: FlightRouteShape;
  flightRouteWidth?: number;
  airportColor?: [number, number, number] | null;
  flightMarkerSize?: number;
  // Cruise domain
  /** How cruise routes are coloured + the user's colour per slot. Owned by
   *  `store/cruiseColorStore.ts`; both maps and the dashboard legend read it
   *  from there so they can never disagree. */
  cruiseColorMode?: CruiseColorMode;
  cruiseColors?: CruiseColors;
  /**
   * @deprecated Pre-mode single colour override (null = the tab decided the
   * mode). Still READ once, to migrate an existing user forward into
   * `cruiseColorMode` (see `cruiseColorFromStored`); never written again.
   */
  cruiseRouteColor?: [number, number, number] | null;
  cruiseRouteWidth?: number;
  portColor?: [number, number, number] | null;
  cruiseMarkerSize?: number;
  /** Multiplier on cruise direction-arrow size (1 = default, 0 = arrows off). */
  cruiseArrowScale?: number;
  // Lodging domain
  /**
   * Multiplier on the lodging-pin marker size (1 = default, 0 = hidden).
   * Brand-new field (Task 8) — no legacy string-enum form ever existed for
   * it (unlike `flightMarkerSize`/`cruiseMarkerSize`), so it needs no
   * coercion in `normalizeAppearance`; a missing key just defaults to `1`
   * at the read site, same convention as every other appearance field here.
   * Owned by `MapContainer3D` (not `DeckGLMap`, unlike the flight/cruise
   * marker sizes) purely so it persists here the same way every other
   * appearance field does; it's threaded down into `DeckGLMap` as a
   * controlled prop both to render the slider AND (since Task 9) to
   * actually build the lodging pin layer (`buildLodgingPins`), which lives
   * in `DeckGLMap` alongside the cruise-port layer it mirrors.
   */
  lodgingMarkerSize?: number;
  /** How lodging pins are coloured + the user's colour per slot. Owned by
   *  `store/lodgingColorStore.ts`, the same shape flights and cruises use —
   *  one store the layer and the panel both read, so they cannot disagree.
   *  No legacy single-colour field to migrate: pins were always brand rose. */
  lodgingColorMode?: LodgingColorMode;
  lodgingColors?: LodgingColors;
  // POI domain
  /** How place pins are coloured + the user's colour per slot. Owned by
   *  `store/placeColorStore.ts`, the same shape the other three domains use.
   *  Note there is no "by category" mode to persist — category is encoded as
   *  the pin icon, for the separation reason documented in lib/placeColor.ts. */
  placeColorMode?: PlaceColorMode;
  placeColors?: PlaceColors;
  /** Whether the lodging LIST panel is open (its own state, not the map
   *  control panel's `panelExpanded`). It used to open on every mount, so
   *  switching domain and coming back always sprang it open again. */
  lodgingListOpen?: boolean;
  // Layers
  showTerrain?: boolean;
  showPlaceLabels?: boolean;
  labelsMode?: LabelsMode;
  // Chrome
  /** Whether the control panel is expanded (#194). One value for both maps —
   *  it is the same panel to the user. Absent = expanded (the default). */
  panelExpanded?: boolean;
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

// Legacy blobs stored width/size as enum strings ("thin"/"m"/…). Coerce them
// to the numeric scale they used to map to, so an existing user's saved look
// survives the switch to continuous sliders. New writes are already numbers.
function widthScale(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "thin") return 0.6;
  if (v === "normal") return 1;
  if (v === "thick") return 1.6;
  return undefined;
}
function sizeScale(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "off") return 0;
  if (v === "s") return 0.7;
  if (v === "m") return 1;
  if (v === "l") return 1.45;
  return undefined;
}

/** Coerce legacy enum width/size values to numbers; leave everything else as-is. */
export function normalizeAppearance(raw: Record<string, unknown>): MapAppearance {
  const out: MapAppearance = { ...(raw as MapAppearance) };
  const fw = widthScale(raw.flightRouteWidth);
  const cw = widthScale(raw.cruiseRouteWidth);
  const fm = sizeScale(raw.flightMarkerSize);
  const cm = sizeScale(raw.cruiseMarkerSize);
  if (fw === undefined) delete out.flightRouteWidth;
  else out.flightRouteWidth = fw;
  if (cw === undefined) delete out.cruiseRouteWidth;
  else out.cruiseRouteWidth = cw;
  if (fm === undefined) delete out.flightMarkerSize;
  else out.flightMarkerSize = fm;
  if (cm === undefined) delete out.cruiseMarkerSize;
  else out.cruiseMarkerSize = cm;
  return out;
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
      return normalizeAppearance(JSON.parse(raw) as Record<string, unknown>);
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
  return normalizeAppearance(migrated as Record<string, unknown>);
}

/**
 * The flight colour config for the persisted blob, migrating the legacy
 * `routeColor` field on first read:
 *   - `routeColor: null`   → "status" with the default (orange / coral) pair
 *     (NOT "frequency" — `null` was written on every mount, so it can't be
 *     read as a deliberate pick; see the migration comment in
 *     `lib/flightColor.ts` for the full trade-off)
 *   - `routeColor: <rgb>`  → "solid" with that colour
 *   - nothing stored       → "status" with the default (orange / coral) pair
 */
export function loadFlightColorConfig(): FlightColorConfig {
  return flightColorFromStored(loadMapAppearance() as unknown as Record<string, unknown>);
}

/**
 * The cruise colour config from the persisted blob, migrating the legacy
 * `cruiseRouteColor` field on first read:
 *   - `cruiseRouteColor: <rgb>`  → "solid" with that colour (a deliberate pick)
 *   - `cruiseRouteColor: null`   → "status" with the default (blue / cyan) pair
 *   - nothing stored             → "status" with the default pair
 * See the migration comment in `lib/cruiseColor.ts` for the trade-off (the
 * Kreuzfahrten tab's implicit per-cruise colouring is not preserved).
 */
export function loadLodgingColorConfig(): LodgingColorConfig {
  return lodgingColorFromStored(loadMapAppearance() as unknown as Record<string, unknown>);
}

export function loadCruiseColorConfig(): CruiseColorConfig {
  return cruiseColorFromStored(loadMapAppearance() as unknown as Record<string, unknown>);
}

export function loadPlaceColorConfig(): PlaceColorConfig {
  return placeColorFromStored(loadMapAppearance() as unknown as Record<string, unknown>);
}

/**
 * The flat map's flight-route SHAPE from the persisted blob (#183). Defaults to
 * `"arc"` — today's 3D arcs — for every user who has never touched the setting,
 * and for any unrecognised stored value.
 */
export function loadFlightRouteShape(): FlightRouteShape {
  return flightRouteShapeFromStored(loadMapAppearance() as unknown as Record<string, unknown>);
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

// Single source of truth for place-pin colour, its MODE, and the legend rows
// that follow from it — the fourth domain built to the same contract as
// flights, cruises and lodging: the pin layer, the control panel and the
// legend all resolve through this file, never through a private literal.
//
// WHAT IS DELIBERATELY MISSING HERE: a "colour by category" mode.
//
// Map pins are a SCATTER case — any two categories can end up adjacent, so
// every pair has to separate, not merely the neighbours in a legend. Measured
// against that bar, only about the first three slots of a categorical palette
// clear the separation floors, so seven place categories cannot be seven hues.
// Category is therefore encoded as the pin's ICON (shared/placeCategories.ts),
// which additionally survives greyscale, print and forced-colours.
//
// The same measurement shapes the two modes that DO exist: both are
// low-cardinality, and the one distinction that must never be missed — a
// visited place vs. an open target — is carried by SHAPE (filled vs. hollow)
// in the layer, with colour only agreeing. Teal against muted grey measures
// below the normal-vision separation floor, so colour alone would not have
// been enough.

import type { Rgb } from "./cruiseColor";
import { DOMAINS } from "../shared/domains";
import { hexToRgb } from "../components/map/controlPanelKit";

/**
 * How a place pin gets its colour.
 *
 *  - `solid`   one colour for every place. The default, so a user who never
 *              opens the panel sees one consistent domain colour.
 *  - `visited` logbook vs. wishlist. The only split that changes what a pin
 *              MEANS, which is why it is a mode rather than a filter.
 *
 * A `list` mode arrives with the Places-lists phase, where a list finally has
 * a colour to resolve. Adding the slot before the feature would ship a mode
 * that always renders one colour.
 */
export type PlaceColorMode = "solid" | "visited";

/** Render order of the mode picker. */
export const PLACE_COLOR_MODES = ["solid", "visited"] as const;

/**
 * User-settable slots, independent on purpose: switching mode must never
 * clobber a colour picked for another one — the rule every other domain's
 * slots follow.
 */
export interface PlaceColors {
  solid: Rgb;
  visited: Rgb;
  wishlist: Rgb;
}

export type PlaceColorSlot = keyof PlaceColors;

export interface PlaceColorConfig {
  mode: PlaceColorMode;
  colors: PlaceColors;
}

/** The brand POI teal (BRAND.md §3), derived from the SAME domain constant the
 *  pin layer derives from, via the ONE shared `hexToRgb`. */
export const PLACE_COLOR: Rgb = hexToRgb(DOMAINS.poi.color);

export const DEFAULT_PLACE_COLORS: PlaceColors = {
  solid: PLACE_COLOR,
  visited: PLACE_COLOR,
  // Clearly muted rather than a second hue: a wishlist entry is "no information
  // yet", not a category of its own. The layer also draws it hollow, which is
  // what actually carries the distinction.
  wishlist: [110, 116, 128],
};

export const DEFAULT_PLACE_COLOR_CONFIG: PlaceColorConfig = {
  mode: "solid",
  colors: DEFAULT_PLACE_COLORS,
};

/** Quick-pick swatches offered beside each colour field. */
export const PLACE_COLOR_PRESETS: readonly Rgb[] = [
  PLACE_COLOR,
  [148, 163, 184],
  [125, 176, 219],
  [196, 154, 108],
  [126, 178, 121],
  [226, 232, 240],
];

/** The minimum a colour resolver needs to know about a place. */
export interface PlaceColorInput {
  visited?: boolean;
}

/**
 * THE place-pin colour function. The pin layer and the legend call it; nothing
 * else may decide a place's hue.
 */
export function resolvePlaceColor(place: PlaceColorInput, cfg: PlaceColorConfig): Rgb {
  const { mode, colors } = cfg;
  if (mode === "visited") {
    return place.visited ? colors.visited : colors.wishlist;
  }
  return colors.solid;
}

/** The slots a given mode actually uses — the panel renders only these. */
export function slotsForPlaceMode(mode: PlaceColorMode): readonly PlaceColorSlot[] {
  return mode === "visited" ? (["visited", "wishlist"] as const) : (["solid"] as const);
}

function isRgb(v: unknown): v is Rgb {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isPlaceColorMode(v: unknown): v is PlaceColorMode {
  return (PLACE_COLOR_MODES as readonly string[]).includes(v as string);
}

function readColors(raw: unknown): PlaceColors {
  if (raw === null || typeof raw !== "object") return DEFAULT_PLACE_COLORS;
  const rec = raw as Record<string, unknown>;
  const out = {} as PlaceColors;
  for (const slot of Object.keys(DEFAULT_PLACE_COLORS) as PlaceColorSlot[]) {
    out[slot] = isRgb(rec[slot]) ? (rec[slot] as Rgb) : DEFAULT_PLACE_COLORS[slot];
  }
  return out;
}

/**
 * Derive the place colour config from a persisted appearance blob.
 *
 * No legacy field to migrate — the domain is new, so an absent key means "the
 * user has not chosen", which is exactly the default.
 */
export function placeColorFromStored(raw: Record<string, unknown>): PlaceColorConfig {
  if (isPlaceColorMode(raw.placeColorMode)) {
    return { mode: raw.placeColorMode, colors: readColors(raw.placeColors) };
  }
  return DEFAULT_PLACE_COLOR_CONFIG;
}

/** One row of the map legend. Shape mirrors `LodgingLegendRow` /
 *  `FlightLegendRow` so `AllTab` renders every domain through one renderer. */
export interface PlaceLegendRow {
  kind: "swatch";
  slot: PlaceColorSlot;
  color: Rgb;
}

/**
 * Legend rows for place pins, DERIVED from the same config the pin layer
 * resolves through — which is what makes it structurally impossible for the
 * legend and the map to disagree.
 */
export function buildPlaceLegend(
  cfg: PlaceColorConfig = DEFAULT_PLACE_COLOR_CONFIG
): PlaceLegendRow[] {
  return slotsForPlaceMode(cfg.mode).map((slot) => ({
    kind: "swatch" as const,
    slot,
    color: cfg.colors[slot],
  }));
}

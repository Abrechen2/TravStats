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
 *  - `list`    the colour of the list the place belongs to. Arrived with the
 *              lists phase, because only then did a list have a colour to
 *              resolve; the slot was deliberately not reserved earlier, which
 *              would have shipped a mode that always rendered one colour.
 *
 * `list` is the one mode whose colour does NOT come from `colors` — it comes
 * from the user's own lists, so the CALLER resolves membership and hands the
 * hue in (`PlaceColorInput.listColor`). Keeping the lookup out of here is what
 * lets the resolver stay a pure function of its arguments; the layer already
 * has the membership map, and this file has no business fetching one.
 */
export type PlaceColorMode = "solid" | "visited" | "list";

/** Render order of the mode picker. */
export const PLACE_COLOR_MODES = ["solid", "visited", "list"] as const;

/**
 * User-settable slots, independent on purpose: switching mode must never
 * clobber a colour picked for another one — the rule every other domain's
 * slots follow.
 */
export interface PlaceColors {
  solid: Rgb;
  visited: Rgb;
  wishlist: Rgb;
  /** Fallback in `list` mode for a place that is in no list at all. Muted for
   *  the same reason `wishlist` is: "not filed anywhere" is an absence of
   *  information, not a category competing with the user's own colours. */
  unlisted: Rgb;
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
  unlisted: [110, 116, 128],
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
  /**
   * The colour of the list this place belongs to, already resolved by the
   * caller. Undefined means "in no list" in `list` mode, and is ignored in
   * every other mode.
   *
   * A place can be in MANY lists — that is the whole reason membership is its
   * own table — so the caller also decides WHICH one wins. The rule lives in
   * `resolvePlaceListColors` next door, in one place, rather than being
   * re-invented per layer.
   */
  listColor?: Rgb;
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
  if (mode === "list") {
    return place.listColor ?? colors.unlisted;
  }
  return colors.solid;
}

/**
 * The slots a given mode actually uses — the panel renders only these.
 *
 * `list` yields ONLY the fallback: the other colours in that mode are the
 * user's own list colours, which they edit on the list, not in a map panel.
 * Offering a picker here would be a second place to set the same thing.
 */
export function slotsForPlaceMode(mode: PlaceColorMode): readonly PlaceColorSlot[] {
  if (mode === "visited") return ["visited", "wishlist"] as const;
  if (mode === "list") return ["unlisted"] as const;
  return ["solid"] as const;
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

// ---------------------------------------------------------------- list mode

/** The little a list has to expose for its colour to reach a pin. */
export interface PlaceListColorSource {
  id: string;
  name: string;
  /** Hex, as stored on `PlaceList.color`. */
  color: string;
  entries?: readonly { placeId: string }[];
}

export interface PlaceListColorResolution {
  /** Place id → the list colour that won. Places in no list are absent. */
  byPlaceId: Map<string, Rgb>;
  /** Lists that actually colour at least one pin, in the order given. */
  used: Array<{ id: string; name: string; color: Rgb }>;
}

/**
 * Resolve list membership into one colour per place.
 *
 * **A place can be in many lists** — the McDonald's at the Trevi Fountain is in
 * "Maccis" and in "Rom", which is exactly why membership is its own table. A
 * pin still has one colour, so something has to win, and the rule is: the FIRST
 * list in the order given. Lists arrive sorted by `sortIdx` then name, so the
 * winner is the one the user themselves ordered first — a rule they can change
 * by dragging, rather than one hidden in a layer.
 *
 * The alternative, blending or striping, was not attempted: two hues averaged
 * are a third hue that matches no legend row.
 */
export function resolvePlaceListColors(
  lists: readonly PlaceListColorSource[]
): PlaceListColorResolution {
  const byPlaceId = new Map<string, Rgb>();
  const used: PlaceListColorResolution["used"] = [];

  for (const list of lists) {
    const rgb = hexToRgb(list.color);
    let colouredAny = false;
    for (const entry of list.entries ?? []) {
      if (byPlaceId.has(entry.placeId)) continue; // first list wins
      byPlaceId.set(entry.placeId, rgb);
      colouredAny = true;
    }
    if (colouredAny) used.push({ id: list.id, name: list.name, color: rgb });
  }

  return { byPlaceId, used };
}

/** One row of the map legend. Shape mirrors `LodgingLegendRow` /
 *  `FlightLegendRow` so `AllTab` renders every domain through one renderer. */
export interface PlaceLegendRow {
  kind: "swatch";
  /** Stable key. For the built-in slots it is also the i18n suffix; a list row
   *  carries `list:<id>` and its own `label`, which has no translation. */
  slot: PlaceColorSlot | `list:${string}`;
  color: Rgb;
  /** A user-authored name (a list). Absent → the caller translates `slot`. */
  label?: string;
}

/**
 * Legend rows for place pins, DERIVED from the same config the pin layer
 * resolves through — which is what makes it structurally impossible for the
 * legend and the map to disagree.
 *
 * In `list` mode the rows are the user's lists, so they have to be passed in;
 * with none, the mode still renders its honest single row ("in no list").
 */
export function buildPlaceLegend(
  cfg: PlaceColorConfig = DEFAULT_PLACE_COLOR_CONFIG,
  usedLists: PlaceListColorResolution["used"] = []
): PlaceLegendRow[] {
  const rows: PlaceLegendRow[] =
    cfg.mode === "list"
      ? usedLists.map((l) => ({
          kind: "swatch" as const,
          slot: `list:${l.id}` as const,
          color: l.color,
          label: l.name,
        }))
      : [];

  for (const slot of slotsForPlaceMode(cfg.mode)) {
    rows.push({ kind: "swatch", slot, color: cfg.colors[slot] });
  }
  return rows;
}

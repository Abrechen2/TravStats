// Single source of truth for lodging pin colour, its MODE, and the map-legend
// rows that follow from it.
//
// It began as one fixed brand colour with a one-row legend, on the reasoning
// that lodging — unlike flights and cruises — had nothing to distinguish. That
// held only while every house looked alike on the map. A list of hundreds does
// have distinctions worth seeing, so lodging now carries a mode like the other
// two domains, built to the SAME contract: the pin layer, the control panel and
// the legend all resolve through this file, never through a private literal.
//
// `LODGING_COLOR` survives unchanged as the brand rose and the default, so a
// user who never opens the panel sees exactly what they saw before.

import { paletteLedBy } from "./listPalette";
import type { Rgb } from "./cruiseColor";
import { DOMAINS } from "../shared/domains";
import { hexToRgb } from "../components/map/controlPanelKit";

/**
 * How a lodging pin gets its colour — the third domain to get a mode, after
 * flights and cruises, and built the same way for the same reason: the hue
 * must be decided in ONE place that the layer, the panel and any legend all
 * read, or they drift.
 *
 * The modes are chosen from what a lodging actually carries, not from what
 * would look clever:
 *
 *  - `solid`   one colour for every house. The old behaviour, and still the
 *              default, so nothing changes for someone who never opens the
 *              panel.
 *  - `type`    hotel / guesthouse / apartment / hostel / campsite. The one
 *              distinction every row has, because the field is required.
 *  - `rating`  how the stay was judged. Only some rows are rated, so this mode
 *              needs an honest "not rated" colour rather than pretending a
 *              missing rating is a bad one.
 *  - `chain`   independent vs. part of a chain. Answers "where do I keep
 *              landing", which is what a chain column is for.
 */
export type LodgingColorMode = "solid" | "type" | "rating" | "chain";

/** Render order of the mode picker. */
export const LODGING_COLOR_MODES = ["solid", "type", "rating", "chain"] as const;

/**
 * The user-settable slots. Independent on purpose: switching mode must never
 * clobber a colour picked for another one — the same rule the cruise slots
 * follow.
 */
export interface LodgingColors {
  solid: Rgb;
  hotel: Rgb;
  guesthouse: Rgb;
  apartment: Rgb;
  hostel: Rgb;
  campsite: Rgb;
  rated: Rgb;
  unrated: Rgb;
  chain: Rgb;
  independent: Rgb;
}

export type LodgingColorSlot = keyof LodgingColors;

export interface LodgingColorConfig {
  mode: LodgingColorMode;
  colors: LodgingColors;
}

/** The brand lodging rose (BRAND.md §3) — derived from the SAME constant
 *  `lodgingPinsLayer.ts` derives from, via the ONE shared `hexToRgb`. Kept
 *  under its original name because the pin layer and the legend both import
 *  it. */
export const LODGING_COLOR: Rgb = hexToRgb(DOMAINS.lodging.color);

export const DEFAULT_LODGING_COLORS: LodgingColors = {
  solid: LODGING_COLOR,
  // Type palette: the rose stays with "hotel" (the overwhelming majority, and
  // the domain's own colour), the others step away from it in hue rather than
  // in brightness — a brightness ramp would read as a rating, which is a
  // different mode.
  hotel: LODGING_COLOR,
  guesthouse: [148, 163, 184],
  apartment: [125, 176, 219],
  hostel: [196, 154, 108],
  campsite: [126, 178, 121],
  // Rating: one colour for judged, one clearly muted for not judged. Never a
  // red/green scale — an unrated house is not a bad house, and BRAND.md keeps
  // state off colour alone anyway.
  rated: [212, 119, 143],
  unrated: [110, 116, 128],
  chain: [212, 119, 143],
  independent: [148, 163, 184],
};

export const DEFAULT_LODGING_COLOR_CONFIG: LodgingColorConfig = {
  mode: "solid",
  colors: DEFAULT_LODGING_COLORS,
};

/** Quick-pick swatches: the shared ten, led by the lodging domain colour. */
export const LODGING_COLOR_PRESETS: readonly Rgb[] = paletteLedBy(DOMAINS.lodging.color);

/** The minimum a colour resolver needs to know about a lodging. */
export interface LodgingColorInput {
  type?: string | null;
  chainId?: number | null;
  overallRating?: number | null;
}

const TYPE_SLOT: Record<string, LodgingColorSlot> = {
  hotel: "hotel",
  guesthouse: "guesthouse",
  apartment: "apartment",
  hostel: "hostel",
  campsite: "campsite",
};

/**
 * THE lodging-pin colour function. The pin layer and any legend call it;
 * nothing else may decide a house's hue.
 *
 * Every branch falls back to the mode's own neutral rather than to a random
 * colour, so an unknown type or a missing rating is visibly "no information",
 * not a category of its own invention.
 */
export function resolveLodgingColor(lodging: LodgingColorInput, cfg: LodgingColorConfig): Rgb {
  const { mode, colors } = cfg;
  if (mode === "type") {
    const slot = TYPE_SLOT[(lodging.type ?? "").toLowerCase()];
    return slot ? colors[slot] : colors.solid;
  }
  if (mode === "rating") {
    return lodging.overallRating != null ? colors.rated : colors.unrated;
  }
  if (mode === "chain") {
    return lodging.chainId != null ? colors.chain : colors.independent;
  }
  return colors.solid;
}

/** The slots a given mode actually uses — the panel renders only these. */
export function slotsForMode(mode: LodgingColorMode): readonly LodgingColorSlot[] {
  if (mode === "type") return ["hotel", "guesthouse", "apartment", "hostel", "campsite"];
  if (mode === "rating") return ["rated", "unrated"];
  if (mode === "chain") return ["chain", "independent"];
  return ["solid"];
}

function isRgb(v: unknown): v is Rgb {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isLodgingColorMode(v: unknown): v is LodgingColorMode {
  return (LODGING_COLOR_MODES as readonly string[]).includes(v as string);
}

function readColors(raw: unknown): LodgingColors {
  if (raw === null || typeof raw !== "object") return DEFAULT_LODGING_COLORS;
  const rec = raw as Record<string, unknown>;
  const pick = (slot: LodgingColorSlot): Rgb =>
    isRgb(rec[slot]) ? (rec[slot] as Rgb) : DEFAULT_LODGING_COLORS[slot];
  const out = {} as LodgingColors;
  for (const slot of Object.keys(DEFAULT_LODGING_COLORS) as LodgingColorSlot[]) {
    out[slot] = pick(slot);
  }
  return out;
}

/**
 * Derive the lodging colour config from a persisted appearance blob.
 *
 * No legacy field to migrate: lodging pins never had a user-settable colour
 * before, they were always the brand rose. An absent key therefore means "the
 * user has not chosen", which is exactly the default — no coercion needed,
 * unlike the flight and cruise configs that had to carry an older single-colour
 * override forward.
 */
export function lodgingColorFromStored(raw: Record<string, unknown>): LodgingColorConfig {
  if (isLodgingColorMode(raw.lodgingColorMode)) {
    return { mode: raw.lodgingColorMode, colors: readColors(raw.lodgingColors) };
  }
  return DEFAULT_LODGING_COLOR_CONFIG;
}

/** One row of the map legend. The shape mirrors `FlightLegendRow` /
 *  `CruiseLegendRow`'s "swatch" variant so `AllTab` can render all three
 *  domains through the same renderer — that stays true now that lodging has
 *  more than one row. */
export interface LodgingLegendRow {
  kind: "swatch";
  slot: LodgingColorSlot;
  color: Rgb;
}

/**
 * The legend rows for lodging pins, DERIVED from the same config the pin layer
 * resolves through — which is what makes it structurally impossible for the
 * legend and the map to disagree.
 *
 * Takes the config rather than reading the store, so it stays a pure function
 * and the tests can state a mode instead of arranging global state. Called
 * without one it answers for the default (solid rose), which is what the
 * one-row version always returned.
 */
export function buildLodgingLegend(
  cfg: LodgingColorConfig = DEFAULT_LODGING_COLOR_CONFIG
): LodgingLegendRow[] {
  return slotsForMode(cfg.mode).map((slot) => ({
    kind: "swatch" as const,
    slot,
    color: cfg.colors[slot],
  }));
}

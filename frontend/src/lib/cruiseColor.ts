// Single source of truth for how cruise routes are coloured.
//
// Cruises had the same three-competing-systems problem flights had (see
// `lib/flightColor.ts`), only worse — the mode was not even a setting:
//   1. the colour MODE was hardcoded PER VIEW in the tab that mounted the map
//      ("status" in the Alle tab, "perCruise" in the Kreuzfahrten tab), so the
//      user had no say and never saw that "a colour per cruise" existed,
//   2. a single `cruiseRouteColor` picker silently OVERRODE whatever the mode
//      resolved — pick a colour and sailed/planned collapsed into one, and
//   3. the dashboard legend hardcoded blue/cyan as string literals, so it kept
//      claiming those colours no matter what the map actually drew.
//
// It is now ONE explicit mode with user-settable colours, read from
// `store/cruiseColorStore.ts` by every renderer and by the legend:
//   - "status"    — two colours: sailed + planned (the default)
//   - "perCruise" — a distinct hue per cruise (the palette below); this always
//                   existed, it was just invisible to the user
//   - "solid"     — one colour for every cruise route
//
// There is deliberately NO "frequency" mode: you rarely sail the same route
// twice, so a frequency ramp would be a heatmap of ones.

export type Rgb = [number, number, number];

// Curated distinct hues for telling individual cruises apart (#150). Chosen to
// avoid the four status colors (flight orange/coral, cruise blue/cyan) and
// the domain colors (flight #f0a947, cruise #6fa0d6, lodging #d4778f, poi
// #5ec2b2). Dark-theme legible.
export const CRUISE_DISTINCT_PALETTE: Rgb[] = [
  [232, 131, 116], // coral
  [244, 191, 79], // gold
  [126, 200, 122], // green
  [95, 194, 178], // teal-green
  [130, 170, 255], // indigo-blue
  [178, 132, 224], // violet
  [232, 138, 196], // pink
  [214, 160, 92], // ochre
  [120, 205, 214], // cyan
  [176, 196, 108], // olive
];

/** FNV-1a-ish stable string hash → non-negative int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deriveCruiseColor(id: string): Rgb {
  return CRUISE_DISTINCT_PALETTE[hashString(id) % CRUISE_DISTINCT_PALETTE.length];
}

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The per-cruise hue: the cruise's own stored colour if it has one, else a
 *  stable hue derived from its id. Unchanged by the mode redesign — "perCruise"
 *  simply surfaces it. */
export function resolveCruiseColor(cruise: { id: string; color?: string | null }): Rgb {
  if (cruise.color) {
    const parsed = parseHex(cruise.color);
    if (parsed) return parsed;
  }
  return deriveCruiseColor(cruise.id);
}

/** How cruise routes are tinted. Mirrors `FlightColorMode`, so both domains
 *  read the same way — minus "frequency", plus "perCruise". */
export type CruiseColorMode = "status" | "perCruise" | "solid";

/** Render order of the mode picker in both control panels. */
export const CRUISE_COLOR_MODES = ["status", "perCruise", "solid"] as const;

/** The user-settable colour slots. `past`/`planned` drive "status" mode,
 *  `solid` tints every route in "solid" mode. "perCruise" has no slot — its
 *  colours come from the cruise itself. Slots are independent so switching
 *  modes never clobbers a colour picked for another mode. */
export interface CruiseColors {
  past: Rgb;
  planned: Rgb;
  solid: Rgb;
}

export type CruiseColorSlot = keyof CruiseColors;

export interface CruiseColorConfig {
  mode: CruiseColorMode;
  colors: CruiseColors;
}

// Status-mode defaults now live in `lib/statusColors.ts` beside the flight
// pair, because they answer one question — what a status looks like on a map —
// and answering it in two files is how the two domains drifted onto four
// unrelated hues in the first place. Re-exported here so every existing import
// of this module keeps working.
export { CRUISE_STATUS_PAST_COLOR, CRUISE_STATUS_PLANNED_COLOR } from "./statusColors";
import { paletteLedBy } from "./listPalette";
import { tokens } from "../theme/tokens";
import { CRUISE_STATUS_PAST_COLOR, CRUISE_STATUS_PLANNED_COLOR } from "./statusColors";

export const DEFAULT_CRUISE_COLORS: CruiseColors = {
  past: CRUISE_STATUS_PAST_COLOR,
  planned: CRUISE_STATUS_PLANNED_COLOR,
  solid: CRUISE_STATUS_PAST_COLOR,
};

export const DEFAULT_CRUISE_COLOR_CONFIG: CruiseColorConfig = {
  mode: "status",
  colors: DEFAULT_CRUISE_COLORS,
};

/** Quick-pick swatches: the shared ten, led by the cruise domain colour. */
export const CRUISE_COLOR_PRESETS: readonly Rgb[] = paletteLedBy(tokens.domainColor.cruise);

/** The minimum a colour resolver needs to know about a cruise. */
export interface CruiseColorInput {
  id: string;
  status: string;
  color?: string | null;
}

/**
 * THE cruise-route colour function. Both renderers (flat map
 * `layers/cruiseArcsLayer.ts`, globe `GlobeView.tsx`) and the dashboard legend
 * call it — nothing else may decide a cruise route's hue. There is no override
 * path left: the config is the only input.
 */
export function resolveCruiseArcColor(cruise: CruiseColorInput, cfg: CruiseColorConfig): Rgb {
  const { colors, mode } = cfg;
  if (mode === "solid") return colors.solid;
  if (mode === "perCruise") return resolveCruiseColor(cruise);
  // "status"
  return cruise.status === "scheduled" ? colors.planned : colors.past;
}

/** One row of the map legend. `slot` doubles as the i18n key discriminator so
 *  adding a mode later never means touching the legend's colour values. */
export type CruiseLegendRow =
  | { kind: "swatch"; slot: CruiseColorSlot; color: Rgb }
  | { kind: "multi"; slot: "perCruise"; stops: Rgb[] };

/** How many palette hues the "perCruise" legend row samples. */
export const CRUISE_LEGEND_SAMPLE_COUNT = 5;

// Synthetic probes: the legend asks the resolver "what colour would a sailed /
// a planned cruise get?" rather than keeping its own table of colour literals.
const PROBE_SAILED: CruiseColorInput = { id: "legend", status: "flown" };
const PROBE_PLANNED: CruiseColorInput = { id: "legend", status: "scheduled" };

/**
 * The legend rows for the active config — derived from `resolveCruiseArcColor`,
 * NOT from a parallel table of colour literals. This is what makes it
 * structurally impossible for the legend and the map to disagree.
 *
 * "perCruise" has no single colour to show, and enumerating every cruise would
 * turn the legend into a second sidebar. It gets ONE honest row instead: a
 * multi-hue swatch sampled from the very palette the arcs are drawn from, with
 * a "one colour per cruise" label.
 */
export function buildCruiseLegend(cfg: CruiseColorConfig): CruiseLegendRow[] {
  switch (cfg.mode) {
    case "status":
      return [
        { kind: "swatch", slot: "past", color: resolveCruiseArcColor(PROBE_SAILED, cfg) },
        { kind: "swatch", slot: "planned", color: resolveCruiseArcColor(PROBE_PLANNED, cfg) },
      ];
    case "perCruise":
      return [
        {
          kind: "multi",
          slot: "perCruise",
          stops: CRUISE_DISTINCT_PALETTE.slice(0, CRUISE_LEGEND_SAMPLE_COUNT),
        },
      ];
    case "solid":
      return [{ kind: "swatch", slot: "solid", color: resolveCruiseArcColor(PROBE_SAILED, cfg) }];
  }
}

// ── localStorage migration ───────────────────────────────────────────────
// Pre-mode blobs carried a single `cruiseRouteColor` field:
//   <rgb>     → the user deliberately picked one tint for every cruise route
//   null      → no colour picked; the MODE then came from whichever tab was
//               mounted ("status" in Alle, "perCruise" in Kreuzfahrten)
//   (absent)  → the user never touched it
//
// `<rgb>` maps to "solid" (a deliberate pick, honoured), everything else to
// "status" with the default blue/cyan pair.
//
// The trade-off, stated plainly: there is NO migration that preserves both
// views, because the two views rendered the same stored state differently. The
// Kreuzfahrten tab loses its automatic per-cruise colouring. Preserving the
// "Alle" view wins — that is the dashboard everyone lands on — and "Pro Reise"
// is now one click away in the panel, discoverable for the first time.

function isRgb(v: unknown): v is Rgb {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isCruiseColorMode(v: unknown): v is CruiseColorMode {
  return v === "status" || v === "perCruise" || v === "solid";
}

function readColors(raw: unknown): CruiseColors {
  if (raw === null || typeof raw !== "object") return DEFAULT_CRUISE_COLORS;
  const rec = raw as Record<string, unknown>;
  const pick = (slot: CruiseColorSlot): Rgb =>
    isRgb(rec[slot]) ? (rec[slot] as Rgb) : DEFAULT_CRUISE_COLORS[slot];
  return { past: pick("past"), planned: pick("planned"), solid: pick("solid") };
}

/**
 * Derive the cruise colour config from a persisted appearance blob, migrating
 * the legacy `cruiseRouteColor` field when the new keys aren't there yet.
 */
export function cruiseColorFromStored(raw: Record<string, unknown>): CruiseColorConfig {
  if (isCruiseColorMode(raw.cruiseColorMode)) {
    return { mode: raw.cruiseColorMode, colors: readColors(raw.cruiseColors) };
  }
  if (isRgb(raw.cruiseRouteColor)) {
    return { mode: "solid", colors: { ...DEFAULT_CRUISE_COLORS, solid: raw.cruiseRouteColor } };
  }
  return DEFAULT_CRUISE_COLOR_CONFIG;
}

// Single source of truth for how flight routes are coloured.
//
// Flights used to have THREE competing colour systems bolted together:
//   1. a frequency palette (routeColor === null → heatmap by route count),
//   2. a `statusTwoTone` hard override (warm = flown, cool = upcoming) that
//      was active only in the multi-domain "Alle" view and silently DISCARDED
//      the user's colour, and
//   3. a single-colour override (routeColor === <rgb>).
// The user-visible symptoms were: the colour picker "does nothing" for
// flights, the "Frequenz" pill looked like a reset button, and the legend
// hardcoded its own colour strings so it could never follow either.
//
// They are now ONE explicit mode with user-settable colours:
//   - "status"    — two colours: flown + planned (the new default)
//   - "frequency" — one base colour, intensity scales with route frequency
//   - "solid"     — one colour for every route
//
// Every renderer (flat map `layers/routesLayer.ts`, globe
// `Globe/buildGlobeLayers.ts`) AND the dashboard legend
// (`Dashboard/tabs/AllTab.tsx`) resolve their colours through
// `resolveFlightColor` / `buildFlightLegend` below, so the map and the legend
// cannot disagree, and a future 4th mode needs no legend edit.

import { paletteLedBy } from "./listPalette";
import { tokens } from "../theme/tokens";
import type { Rgb } from "./cruiseColor";
import { FLIGHT_STATUS_PAST_COLOR, FLIGHT_STATUS_UPCOMING_COLOR } from "./statusColors";

/** How flight routes are tinted. Mirrors the shape cruises already have
 *  (`CruiseColorMode`), so both domains read the same way. */
export type FlightColorMode = "status" | "frequency" | "solid";

/** Render order of the mode picker in both control panels. */
export const FLIGHT_COLOR_MODES = ["status", "frequency", "solid"] as const;

/** The user-settable colour slots. `past`/`upcoming` drive "status" mode,
 *  `frequency` is the base hue of the frequency ramp, `solid` tints every
 *  route in "solid" mode. Slots are independent so switching modes back and
 *  forth never clobbers a colour the user picked for another mode. */
export interface FlightColors {
  past: Rgb;
  upcoming: Rgb;
  frequency: Rgb;
  solid: Rgb;
}

export type FlightColorSlot = keyof FlightColors;

export interface FlightColorConfig {
  mode: FlightColorMode;
  colors: FlightColors;
}

/** Defaults: orange (flown) + coral (planned) in BOTH views. The flight-only
 *  view used to default planned routes to sky-blue while the "Alle" view used
 *  coral — two hidden defaults for one concept, which is exactly the confusion
 *  this redesign removes. Sky-blue survives as a palette preset below. */
export const DEFAULT_FLIGHT_COLORS: FlightColors = {
  past: FLIGHT_STATUS_PAST_COLOR,
  upcoming: FLIGHT_STATUS_UPCOMING_COLOR,
  frequency: FLIGHT_STATUS_PAST_COLOR,
  solid: FLIGHT_STATUS_PAST_COLOR,
};

export const DEFAULT_FLIGHT_COLOR_CONFIG: FlightColorConfig = {
  mode: "status",
  colors: DEFAULT_FLIGHT_COLORS,
};

/** Quick-pick swatches offered next to each colour field. Includes sky-blue
 *  [80,200,255] — the retired `FLIGHT_STATUS_SCHEDULED_COLOR` — so users who
 *  preferred the old flight-only "planned" tint can pick it back explicitly. */
export const FLIGHT_COLOR_PRESETS: readonly Rgb[] = paletteLedBy(tokens.domainColor.flight);

/** Soft grey for routes whose only flights are historical (legacy data).
 *  Applied ONLY in "frequency" mode — the mode that inherits the old
 *  auto/heatmap behaviour. An explicit `status` / `solid` choice means the
 *  user asked for THAT colour on every route, grey included. */
export const HISTORICAL_ROUTE_COLOR: Rgb = [150, 150, 150];

/** Frequency band of a route, 0 (rarest) … 3 (most-flown). Derived from the
 *  dataset's own quantiles on the flat map, and from the pre-computed
 *  quartile on the globe — so both renderers land on the same band. */
export type FrequencyTier = 0 | 1 | 2 | 3;

export function frequencyTier(count: number, q25: number, q50: number, q75: number): FrequencyTier {
  if (count <= q25) return 0;
  if (count <= q50) return 1;
  if (count <= q75) return 2;
  return 3;
}

/** Globe quartiles are 1-based (see `Globe/heatmapUtils.getQuartile`). */
export function tierFromQuartile(quartile: number): FrequencyTier {
  const tier = Math.round(quartile) - 1;
  if (tier <= 0) return 0;
  if (tier >= 3) return 3;
  return tier as FrequencyTier;
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Mix a colour toward black (f < 0) or white (f > 0). Hue-preserving, so a
 *  frequency ramp always reads as "more/less of the user's colour". */
function mixToward(base: Rgb, f: number): Rgb {
  if (f >= 0) {
    return [
      clamp255(base[0] + (255 - base[0]) * f),
      clamp255(base[1] + (255 - base[1]) * f),
      clamp255(base[2] + (255 - base[2]) * f),
    ];
  }
  return [clamp255(base[0] * (1 + f)), clamp255(base[1] * (1 + f)), clamp255(base[2] * (1 + f))];
}

// Per-tier intensity: rare routes sit dim, the most-flown ones brighten past
// the base hue. Tier 2 is the base colour itself, so the user's pick is
// literally on the map rather than merely "somewhere in the ramp".
const TIER_MIX: readonly number[] = [-0.45, -0.22, 0, 0.28];

/** Frequency-mode tint for a flown route at the given band. */
export function tintForTier(base: Rgb, tier: FrequencyTier): Rgb {
  return mixToward(base, TIER_MIX[tier]);
}

/** Frequency-mode tint for a planned (never-flown) route: a washed-out
 *  version of the base so "not yet flown" reads as pale but same-family. */
export function washOut(base: Rgb): Rgb {
  return mixToward(base, 0.55);
}

export interface FlightRouteColorInput {
  /** Frequency band of the route (ignored outside "frequency" mode). */
  tier: FrequencyTier;
  /** True when the route carries an upcoming flight and has NEVER been flown.
   *  A mixed route (flown + upcoming) counts as flown — its upcoming leg is
   *  conveyed by the arc's tip gradient, see `resolveFlightTipColor`. */
  pureScheduled: boolean;
  /** True when every flight on the route is `status: "historical"`. */
  isHistorical?: boolean;
}

/**
 * THE flight-route colour function. Both renderers and the legend call it —
 * nothing else may decide a flight arc's hue.
 */
export function resolveFlightColor(input: FlightRouteColorInput, cfg: FlightColorConfig): Rgb {
  const { colors, mode } = cfg;
  if (mode === "solid") return colors.solid;
  if (mode === "status") return input.pureScheduled ? colors.upcoming : colors.past;
  // "frequency"
  if (input.isHistorical) return HISTORICAL_ROUTE_COLOR;
  if (input.pureScheduled) return washOut(colors.frequency);
  return tintForTier(colors.frequency, input.tier);
}

/**
 * Colour of the faded tips an `UpcomingArcLayer` paints onto a MIXED route
 * (already flown AND carrying an upcoming flight). Reads as "there is a
 * planned leg on this route" in whichever mode is active: the planned colour
 * in status mode, the washed base in frequency mode, and the solid colour in
 * solid mode (i.e. invisible tips — one colour means one colour).
 */
export function resolveFlightTipColor(cfg: FlightColorConfig): Rgb {
  return resolveFlightColor({ tier: 3, pureScheduled: true }, cfg);
}

/** One row of the map legend. `slot` doubles as the i18n key discriminator so
 *  adding a mode later never means touching the legend's colour values. */
export type FlightLegendRow =
  | { kind: "swatch"; slot: FlightColorSlot; color: Rgb }
  | { kind: "ramp"; slot: "frequency"; stops: Rgb[] };

/**
 * The legend rows for the active config — derived from `resolveFlightColor`,
 * NOT from a parallel table of colour literals. This is what makes it
 * structurally impossible for the legend and the map to disagree.
 */
export function buildFlightLegend(cfg: FlightColorConfig): FlightLegendRow[] {
  switch (cfg.mode) {
    case "status":
      return [
        {
          kind: "swatch",
          slot: "past",
          color: resolveFlightColor({ tier: 2, pureScheduled: false }, cfg),
        },
        {
          kind: "swatch",
          slot: "upcoming",
          color: resolveFlightColor({ tier: 2, pureScheduled: true }, cfg),
        },
      ];
    case "frequency":
      return [
        {
          kind: "ramp",
          slot: "frequency",
          stops: ([0, 1, 2, 3] as const).map((tier) =>
            resolveFlightColor({ tier, pureScheduled: false }, cfg)
          ),
        },
      ];
    case "solid":
      return [
        {
          kind: "swatch",
          slot: "solid",
          color: resolveFlightColor({ tier: 2, pureScheduled: false }, cfg),
        },
      ];
  }
}

/** `rgb(r,g,b)` CSS string — used by the legend + control-panel swatches. */
export function rgbCss(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── localStorage migration ───────────────────────────────────────────────
// Pre-mode blobs carried a single `routeColor` field:
//   null      → no colour was ever picked (DeckGLMap wrote this on EVERY
//               mount, so it says nothing about intent — see below)
//   <rgb>     → the user deliberately picked a single solid tint
//   (absent)  → the user never touched it
//
// `null` maps to "status", NOT "frequency", even though `null` used to mean
// "the frequency heatmap is active". Reason: `routeColor: null` was written
// unconditionally on every DeckGLMap mount, so virtually every existing user
// has it — the "key absent" branch below was effectively dead. And the view
// those users actually see today, the multi-domain "Alle" dashboard, never
// looked at `routeColor` in the first place: a hard `statusTwoTone` override
// forced flown routes orange / planned routes coral regardless of what was
// stored. Migrating `null` to "status" keeps that view looking the same.
// The trade-off: the flight-only view DID honour the frequency palette for
// `routeColor: null`, and those users will see status colours instead after
// this migration. That's the lesser evil — nobody ever *chose* the frequency
// ramp there, it was just the default, and "Alle" is where most users land.
// There is no migration that preserves both views' current look, because the
// two views rendered the same stored state differently.

function isRgb(v: unknown): v is Rgb {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isFlightColorMode(v: unknown): v is FlightColorMode {
  return v === "status" || v === "frequency" || v === "solid";
}

function readColors(raw: unknown): FlightColors {
  if (raw === null || typeof raw !== "object") return DEFAULT_FLIGHT_COLORS;
  const rec = raw as Record<string, unknown>;
  const pick = (slot: FlightColorSlot): Rgb =>
    isRgb(rec[slot]) ? (rec[slot] as Rgb) : DEFAULT_FLIGHT_COLORS[slot];
  return {
    past: pick("past"),
    upcoming: pick("upcoming"),
    frequency: pick("frequency"),
    solid: pick("solid"),
  };
}

/**
 * Derive the flight colour config from a persisted appearance blob, migrating
 * the legacy `routeColor` field when the new keys aren't there yet.
 */
export function flightColorFromStored(raw: Record<string, unknown>): FlightColorConfig {
  if (isFlightColorMode(raw.flightColorMode)) {
    return { mode: raw.flightColorMode, colors: readColors(raw.flightColors) };
  }
  // Legacy blob — migrate.
  if (isRgb(raw.routeColor)) {
    return { mode: "solid", colors: { ...DEFAULT_FLIGHT_COLORS, solid: raw.routeColor } };
  }
  if ("routeColor" in raw && raw.routeColor === null) {
    return { mode: "status", colors: DEFAULT_FLIGHT_COLORS };
  }
  return DEFAULT_FLIGHT_COLOR_CONFIG;
}

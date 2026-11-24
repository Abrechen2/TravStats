import type { LegMode } from "./api/travtrackLegs";
import type { DomainColorMap } from "./domainColor";
import type { DomainKey } from "../shared/domains";
import { parseCssColor, type Rgb } from "../pages/Track/map/trackTokenRgb";

/**
 * The colour of a leg by its mode (the Track map's „Verkehrsmittel“ mode).
 * Resolution is one function — the user's choice, else the domain colour where
 * the mode has a domain, else a fixed one chosen to be told apart from the
 * domains — and the layer, the legend, the panel and the leg card all read it;
 * none of them holds a colour of its own (CLAUDE.md, map colour modes).
 */

/** Modes that get a colour of their own; a run is a walk for the eye. */
export const MODE_COLOR_KEYS = [
  "flight",
  "car",
  "bus",
  "train",
  "boat",
  "cycle",
  "walk",
  "unknown",
] as const;
export type ModeColorKey = (typeof MODE_COLOR_KEYS)[number];

export const modeColorKeyOf = (mode: LegMode): ModeColorKey => (mode === "run" ? "walk" : mode);

/** The domain whose colour a mode starts from; none for the modes without a domain. */
const DOMAIN_OF: Partial<Record<ModeColorKey, DomainKey>> = {
  flight: "flight",
  car: "rental",
  bus: "bus",
  train: "rail",
  boat: "ferry",
};

/**
 * Walk, bike and unknown have no domain. Their luminance sits between 0.11 and
 * 0.25, which keeps 3:1 against both the dark and the light basemap
 * (`trackModeColor.test.ts` holds the figures).
 */
export const FIXED_MODE_COLORS: Record<"cycle" | "walk" | "unknown", string> = {
  cycle: "#2b8a3e",
  walk: "#d6336c",
  unknown: "#7d8590",
};

export type ModeColorOverrides = Partial<Record<ModeColorKey, string>>;

const HEX = /^#[0-9a-f]{6}$/i;

/** The hex colour of one mode: the user's, else the domain's, else the fixed one. */
export function modeColor(
  key: ModeColorKey,
  overrides: ModeColorOverrides,
  domains: DomainColorMap
): string {
  const own = overrides[key];
  if (own && HEX.test(own)) return own;
  const domain = DOMAIN_OF[key];
  if (domain) return domains[domain];
  return FIXED_MODE_COLORS[key as keyof typeof FIXED_MODE_COLORS];
}

/** Every mode's colour as the channels deck.gl draws with. */
export function modeColorTable(
  overrides: ModeColorOverrides,
  domains: DomainColorMap
): Record<ModeColorKey, Rgb> {
  return Object.fromEntries(
    MODE_COLOR_KEYS.map((k) => [
      k,
      parseCssColor(modeColor(k, overrides, domains)) ?? [128, 128, 128],
    ])
  ) as Record<ModeColorKey, Rgb>;
}

/** A stored overrides object, read key by key; anything that is not `#rrggbb` is dropped. */
export function parseModeColors(raw: unknown): ModeColorOverrides {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  return Object.fromEntries(
    MODE_COLOR_KEYS.flatMap((k) => {
      const v = source[k];
      return typeof v === "string" && HEX.test(v) ? [[k, v.toLowerCase()]] : [];
    })
  );
}

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

/** The light basemaps' ground, and the contrast a route colour keeps against it. */
export const LIGHT_GROUND = "#f2efe9";
export const MIN_ROUTE_CONTRAST = 3;

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
const luminance = (hex: string): number => {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const x = channel(hex, i) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** A darker variant of a colour that keeps 3:1 on the light ground; the colour itself where it already does. */
export function darkenForLightGround(hex: string): string {
  let out = hex;
  for (let i = 0; i < 30 && contrastRatio(out, LIGHT_GROUND) < MIN_ROUTE_CONTRAST; i++) {
    out = `#${[0, 1, 2]
      .map((c) =>
        Math.round(channel(out, c) * 0.92)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")}`;
  }
  return out;
}

/**
 * The hex colour of one mode: the user's choice as picked, else the domain's or
 * the fixed default — on a light basemap a default that would fade into the
 * ground is drawn in a darker variant (the same store, only the ink changes).
 */
export function modeColor(
  key: ModeColorKey,
  overrides: ModeColorOverrides,
  domains: DomainColorMap,
  lightBasemap = false
): string {
  const own = overrides[key];
  if (own && HEX.test(own)) return own;
  const domain = DOMAIN_OF[key];
  const base = domain ? domains[domain] : FIXED_MODE_COLORS[key as keyof typeof FIXED_MODE_COLORS];
  return lightBasemap ? darkenForLightGround(base) : base;
}

/** Every mode's colour as the channels deck.gl draws with. */
export function modeColorTable(
  overrides: ModeColorOverrides,
  domains: DomainColorMap,
  lightBasemap = false
): Record<ModeColorKey, Rgb> {
  return Object.fromEntries(
    MODE_COLOR_KEYS.map((k) => [
      k,
      parseCssColor(modeColor(k, overrides, domains, lightBasemap)) ?? [128, 128, 128],
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

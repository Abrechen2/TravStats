/**
 * One colour per domain, for everything that has room for exactly one.
 *
 * A flight is amber, a cruise is blue, a hotel is rose, a place is teal — on a
 * statistics bar, in a trip timeline chip, on a sidebar dot. That set used to
 * be four fixed hexes nobody could change (`DOMAINS[key].color`, mirroring
 * BRAND.md §3), while the map had four *configurable* colour stores that
 * reached nothing outside the map. The two never met, which is what #270 is
 * about: a user who paints their flights green on the map still had amber
 * bars in the statistics.
 *
 * WHAT THIS IS NOT. It is not a replacement for the map's colour modes. A map
 * arc can be coloured by status, by frequency, per cruise or by list; a bar in
 * "flights per year" has no status, so those modes have nothing to say here.
 * Only a single per-domain colour can travel, and this is it.
 *
 * WHY THE MAP'S SOLID SLOT IS ONLY *SEEDED* FROM THIS, NOT BOUND TO IT. Each
 * map colour store keeps its slots deliberately independent — its own comment
 * says "switching modes back and forth never clobbers a colour the user picked
 * for another mode". Forcing `solid` to follow this value would reintroduce
 * exactly the implicit override that 2.4.0 removed. So a user who has never
 * touched the map's solid picker gets the domain colour there; one who has
 * keeps their choice.
 */

import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../shared/domains";

/** Hex string, `#rrggbb`. Stored as text because that is what a colour input speaks. */
export type DomainColorMap = Readonly<Record<DomainKey, string>>;

/** The brand set from BRAND.md §3 — the value every domain starts at. */
export const BRAND_DOMAIN_COLORS: DomainColorMap = Object.freeze(
  Object.fromEntries(AVAILABLE_DOMAINS.map((key) => [key, DOMAINS[key].color])) as Record<
    DomainKey,
    string
  >
);

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Read a stored map back, keeping only what is actually a colour.
 *
 * Anything unrecognised falls back to the brand value rather than being
 * dropped: a domain with no colour at all would render invisible marks, and a
 * corrupted entry in local storage is not a reason to show a blank chart.
 */
export function normalizeDomainColors(raw: unknown): DomainColorMap {
  if (typeof raw !== "object" || raw === null) return BRAND_DOMAIN_COLORS;
  const source = raw as Record<string, unknown>;
  return Object.freeze(
    Object.fromEntries(
      AVAILABLE_DOMAINS.map((key) => {
        const value = source[key];
        return [
          key,
          typeof value === "string" && HEX.test(value) ? value : BRAND_DOMAIN_COLORS[key],
        ];
      })
    ) as Record<DomainKey, string>
  );
}

/** True when every domain still sits on its brand colour. */
export function isBrandDefault(colors: DomainColorMap): boolean {
  return AVAILABLE_DOMAINS.every(
    (key) => colors[key].toLowerCase() === BRAND_DOMAIN_COLORS[key].toLowerCase()
  );
}

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Relative luminance, per WCAG.
 *
 * Used to decide whether a mark needs an outline, NOT to correct the colour.
 * A user who picks near-black has picked near-black; drawing it with a hairline
 * so it is still findable on a dark panel respects that, silently brightening
 * it does not.
 */
export function luminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Below this a mark is hard to separate from the app's dark ground. */
export const LOW_CONTRAST_LUMINANCE = 0.045;

export function needsOutline(hex: string): boolean {
  return luminance(hex) < LOW_CONTRAST_LUMINANCE;
}

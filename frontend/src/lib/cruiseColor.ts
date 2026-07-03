export type Rgb = [number, number, number];

// Curated distinct hues for telling individual cruises apart (#150). Chosen to
// avoid the four status colors (flight orange/blue, cruise periwinkle/light-
// periwinkle) and the domain colors (flight #f0a947, cruise #6fa0d6, hotel
// #b072d6, poi #5ec2b2). Dark-theme legible.
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

export function resolveCruiseColor(cruise: { id: string; color?: string | null }): Rgb {
  if (cruise.color) {
    const parsed = parseHex(cruise.color);
    if (parsed) return parsed;
  }
  return deriveCruiseColor(cruise.id);
}

/** How cruise arcs/paths are tinted: shared two-tone by status, or a
 *  distinct hue per cruise (#150). Single source of truth for both the
 *  flat map (`components/layers/cruiseArcsLayer.ts`) and the globe
 *  (`components/GlobeView.tsx`) so the two renderers can't drift apart. */
export type CruiseColorMode = "status" | "perCruise";

// Status-mode colors: periwinkle for already-happened legs, a lighter
// tint for scheduled (future) legs so upcoming cruises read as "planned".
export const CRUISE_STATUS_PAST_COLOR: Rgb = [111, 160, 214]; // #6fa0d6
export const CRUISE_STATUS_PLANNED_COLOR: Rgb = [169, 195, 224]; // #a9c3e0

/**
 * Resolve a cruise's arc/path tint for the given color mode. `"status"`
 * collapses every cruise into periwinkle (already sailed) or a lighter
 * "planned" tint (still scheduled); `"perCruise"` hands off to
 * `resolveCruiseColor` for a distinct hue per cruise (#150). Shared by
 * both the flat map and the globe so the two renderers agree pixel-for-
 * pixel on what each mode looks like.
 */
export function resolveCruiseArcColor(
  cruise: { id: string; status: string; color?: string | null },
  mode: CruiseColorMode
): Rgb {
  if (mode === "perCruise") return resolveCruiseColor(cruise);
  return cruise.status === "scheduled" ? CRUISE_STATUS_PLANNED_COLOR : CRUISE_STATUS_PAST_COLOR;
}

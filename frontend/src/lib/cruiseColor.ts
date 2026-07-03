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

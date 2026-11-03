/**
 * deck.gl cannot read CSS custom properties, so a theme token is resolved to
 * the channels the page is drawn with right now. A token that does not parse
 * (no DOM, a colour function this does not know) returns the neutral grey
 * fallback, never a brand colour guessed here.
 */
export type Rgb = [number, number, number];

const NEUTRAL: Rgb = [128, 128, 128];

export function parseCssColor(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export function tokenRgb(name: string, fallback: Rgb = NEUTRAL): Rgb {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--ts-${name}`);
  return parseCssColor(value) ?? fallback;
}

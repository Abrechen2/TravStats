import { describe, it, expect } from "vitest";
import tokens from "../../../../design/tokens.json";

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * CT106 audit B09: the passport's "Belege zeigen" link measured 2.06:1 on the
 * paper — the pressed amber on #ebe7de, the composed row background. Links on
 * the paper read `paperAccent` now; this recomputes the pair against both the
 * paper itself and that darker composed shade, for small (11–12px) text.
 */
describe("paper accent", () => {
  const accent = tokens.color.paperAccent;
  it.each([
    ["the paper", tokens.color.paper],
    ["the composed row background measured on CT106", "#ebe7de"],
  ])("reads at 4.5:1 or better on %s", (_label, background) => {
    expect(contrast(accent, background)).toBeGreaterThanOrEqual(4.5);
  });
});

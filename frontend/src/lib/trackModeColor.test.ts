import { describe, expect, it } from "vitest";
import { BRAND_DOMAIN_COLORS } from "./domainColor";
import {
  FIXED_MODE_COLORS,
  LIGHT_GROUND,
  MODE_COLOR_KEYS,
  modeColor,
  modeColorKeyOf,
  modeColorTable,
  parseModeColors,
} from "./trackModeColor";
import { DEFAULT_PREFS, parsePrefs } from "./webPrefs/trackMap";

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("colour by transport mode", () => {
  it("a mode with a domain starts from that domain's colour, and follows the domain store", () => {
    expect(modeColor("flight", {}, BRAND_DOMAIN_COLORS)).toBe(BRAND_DOMAIN_COLORS.flight);
    expect(modeColor("train", {}, BRAND_DOMAIN_COLORS)).toBe(BRAND_DOMAIN_COLORS.rail);
    expect(modeColor("car", {}, BRAND_DOMAIN_COLORS)).toBe(BRAND_DOMAIN_COLORS.rental);
    const repainted = { ...BRAND_DOMAIN_COLORS, rail: "#112233" };
    expect(modeColor("train", {}, repainted)).toBe("#112233");
  });

  it("the user's setting wins, a corrupt one is ignored, and a run is drawn as a walk", () => {
    expect(modeColor("bus", { bus: "#abcdef" }, BRAND_DOMAIN_COLORS)).toBe("#abcdef");
    expect(modeColor("bus", { bus: "red" }, BRAND_DOMAIN_COLORS)).toBe(BRAND_DOMAIN_COLORS.bus);
    expect(parseModeColors({ bus: "red", boat: "#ABCDEF", nonsense: "#000000" })).toEqual({
      boat: "#abcdef",
    });
    expect(modeColorKeyOf("run")).toBe("walk");
  });

  it("the layer's colour table is the resolved one, and changes with the setting", () => {
    expect(modeColorTable({}, BRAND_DOMAIN_COLORS).walk).toEqual([214, 51, 108]);
    expect(modeColorTable({ walk: "#000000" }, BRAND_DOMAIN_COLORS).walk).toEqual([0, 0, 0]);
  });

  it("the choice is stored with the other track prefs", () => {
    const stored = JSON.stringify({
      ...DEFAULT_PREFS,
      color: "mode",
      modeColors: { cycle: "#010203" },
    });
    const read = parsePrefs(stored);
    expect(read.color).toBe("mode");
    expect(read.modeColors).toEqual({ cycle: "#010203" });
  });

  it("walk, bike and unknown keep 3:1 against the dark and the light basemap", () => {
    for (const hex of Object.values(FIXED_MODE_COLORS)) {
      expect(contrast(hex, "#0b0d10")).toBeGreaterThanOrEqual(3);
      expect(contrast(hex, "#f2efe9")).toBeGreaterThanOrEqual(3);
    }
  });

  it("on a light basemap every default keeps 3:1 against the ground; the user's own pick is left alone", () => {
    for (const key of MODE_COLOR_KEYS) {
      const light = modeColor(key, {}, BRAND_DOMAIN_COLORS, true);
      expect(contrast(light, LIGHT_GROUND)).toBeGreaterThanOrEqual(3);
    }
    // The flight amber fails on the light ground as it is, and the dark style keeps it.
    expect(contrast(BRAND_DOMAIN_COLORS.flight, LIGHT_GROUND)).toBeLessThan(3);
    expect(modeColor("flight", {}, BRAND_DOMAIN_COLORS, true)).not.toBe(BRAND_DOMAIN_COLORS.flight);
    expect(modeColor("flight", {}, BRAND_DOMAIN_COLORS, false)).toBe(BRAND_DOMAIN_COLORS.flight);
    expect(modeColor("flight", { flight: "#ffee00" }, BRAND_DOMAIN_COLORS, true)).toBe("#ffee00");
  });
});

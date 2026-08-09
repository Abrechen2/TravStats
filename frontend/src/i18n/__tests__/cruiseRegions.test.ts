import { describe, it, expect } from "vitest";
import de from "../resources/de/stats.json";
import en from "../resources/en/stats.json";

/**
 * The cruise section used to carry a hardcoded German map of TEN region slugs
 * while the port catalogue ships FIFTY-FOUR. Everything unmapped fell through
 * to a title-case fallback, so a German UI showed "Mittelmeer" and "Ostsee"
 * beside "North Sea" and "Iberian Atlantic" — it read like mixed data but was
 * an incomplete map. And the ten that WERE mapped showed German to English
 * users, because the map was not in i18n at all.
 *
 * These guard both halves: full coverage, and DE/EN in step.
 */
const deRegions = (de as { cruiseSection: { regions: Record<string, string> } }).cruiseSection
  .regions;
const enRegions = (en as { cruiseSection: { regions: Record<string, string> } }).cruiseSection
  .regions;

describe("cruise region labels", () => {
  it("ships both locales", () => {
    expect(Object.keys(deRegions).length).toBeGreaterThan(50);
    expect(Object.keys(enRegions).length).toBeGreaterThan(50);
  });

  it("keeps DE and EN on exactly the same key set", () => {
    expect(Object.keys(deRegions).sort()).toEqual(Object.keys(enRegions).sort());
  });

  it("has no empty label on either side", () => {
    for (const [key, value] of Object.entries(deRegions)) {
      expect(value.trim(), `de.${key}`).not.toBe("");
    }
    for (const [key, value] of Object.entries(enRegions)) {
      expect(value.trim(), `en.${key}`).not.toBe("");
    }
  });

  it("covers the regions that made the mixed-language impression", () => {
    for (const slug of [
      "north_sea",
      "aegean",
      "iberian_atlantic",
      "adriatic",
      "madeira",
      "pacific_northwest",
    ]) {
      expect(deRegions[slug], `de.${slug}`).toBeTruthy();
      expect(enRegions[slug], `en.${slug}`).toBeTruthy();
    }
    // And the German really is German.
    expect(deRegions.north_sea).toBe("Nordsee");
    expect(enRegions.north_sea).toBe("North Sea");
  });

  it("translates the river cruises too, not only the sea regions", () => {
    expect(deRegions.river_rhine).toBe("Rhein");
    expect(deRegions.river_danube).toBe("Donau");
    expect(enRegions.river_rhine).toBe("Rhine");
  });
});

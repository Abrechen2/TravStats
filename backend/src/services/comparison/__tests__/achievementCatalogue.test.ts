import { achievements } from "../../../data/achievements";
import { NON_COMPARABLE_REQUIREMENT_TYPES } from "../../../data/achievementComparable";
import { catalogueVersion, comparableAchievements } from "../achievementCatalogue";

describe("achievement catalogue", () => {
  it("catalogueVersion is stable across calls and changes when a requirement changes", () => {
    const before = catalogueVersion();
    expect(before).toMatch(/^[a-f0-9]{16}$/);
    expect(catalogueVersion()).toBe(before);
    const target = comparableAchievements()[0];
    const original = target.requirement;
    try {
      target.requirement = original + 1;
      expect(catalogueVersion()).not.toBe(before);
    } finally {
      target.requirement = original;
    }
    expect(catalogueVersion()).toBe(before);
  });

  it("no comparable achievement names a place", () => {
    expect(NON_COMPARABLE_REQUIREMENT_TYPES.size).toBeGreaterThan(0);
    const placeWords =
      /\b(antarctic|arctic|polar|panama|suez|equator|caribbean|mediterran|baltic|fjord|scandinav|pilgrim|micro-?state|island|ocean|date ?line|datumsgrenze|aequator|äquator|kanal|unesco|world heritage|wonders|warship|carnival|latitude|breitengrad|birthday|geburtstag|tracktrack|travtrack)\b/i;
    const offenders = comparableAchievements()
      .filter((a) => placeWords.test(`${a.code} ${a.description} ${a.requirementType}`))
      .map((a) => a.code);
    expect(offenders).toEqual([]);
  });

  it("a hidden badge or a place-specific requirement type is never comparable", () => {
    for (const a of achievements) {
      if (a.isHidden || NON_COMPARABLE_REQUIREMENT_TYPES.has(a.requirementType))
        expect(a.comparable).toBe(false);
    }
    expect(comparableAchievements().length).toBeGreaterThan(100);
  });
});

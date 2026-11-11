import { describe, it, expect } from "vitest";
import { AREA_MENU, AREA_PAGES } from "../Settings/area/areaModel";
import { SECTION_ALIASES, SETTINGS_SECTIONS } from "../Settings/settingsModel";

// The menu is the area's: every page once, in the order the owner set. The
// mounts' ids are the anchors old links carry, so they stay unique per page and
// every renamed section id keeps resolving.
describe("settings menu order", () => {
  it("lists the pages in the owner's order", () => {
    expect(AREA_MENU.flatMap((g) => g.pages)).toEqual([
      // Mein Konto
      "profil",
      "anzeige",
      "reisearten",
      "reisen",
      "fluege",
      "kreuzfahrten",
      "unterkuenfte",
      "treue",
      "erinnerungen",
      "freunde",
      "telefone",
      "dienstek",
      "daten",
      "ueber",
      // TravTrack, TravPlan
      "tt-aufz",
      "tt-erk",
      "tt-daten",
      "pl-plan",
      // Server
      "allgemein",
      "nutzer",
      "funktionen",
      "buchungen",
      "sicherungen",
      "wartung",
      "stamm",
    ]);
  });

  it("lists every page exactly once", () => {
    const menu = AREA_MENU.flatMap((g) => g.pages);
    expect([...menu].sort()).toEqual(AREA_PAGES.map((p) => p.id).sort());
  });

  it("gives every mount exactly one home", () => {
    const ids = AREA_PAGES.flatMap((p) => p.sections.map((s) => `${p.id}/${s.id}`));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every section id and alias resolving", () => {
    const sectionIds = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));
    expect(sectionIds.size).toBe(SETTINGS_SECTIONS.length);
    for (const [alias, target] of Object.entries(SECTION_ALIASES)) {
      expect(sectionIds.has(target), alias).toBe(true);
    }
  });
});

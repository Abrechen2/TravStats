import { describe, expect, it } from "vitest";
import { sectionsOf } from "../../surface";
import { AREA_MENU, AREA_PAGES, findAreaPage } from "../areaModel";
import { registryPage } from "../../registry";
import { SETTINGS_SECTIONS } from "../../settingsModel";
import de from "../../../../i18n/resources/de/settings.json";
import en from "../../../../i18n/resources/en/settings.json";

/** The Standort page became TravTrack (web redesign, 2026-11-05, "Settings page"). */
const ORDER = [
  "ttRecording",
  "ttPlaces",
  "ttZones",
  "ttDetect",
  "ttSources",
  "ttExport",
  "ttDelete",
  "ttDiag",
];

describe("the TravTrack settings page", () => {
  it("is in the menu as TravTrack at the place of Standort, in both languages", () => {
    const account = AREA_MENU.find((g) => g.id === "account")!.pages;
    expect(account).toContain("travtrack");
    expect(account).not.toContain("location");
    expect(account.indexOf("travtrack")).toBe(account.indexOf("notifications") + 1);
    expect(findAreaPage("location")).toBeUndefined();
    expect(de.area.pages.travtrack).toBe("TravTrack");
    expect(en.area.pages.travtrack).toBe("TravTrack");
    expect(Object.keys(de.area.pages)).not.toContain("location");
  });

  it("holds the eight sections in the spec's order, in the registry and on the page", () => {
    expect(registryPage("travtrack")!.sections.map((s) => s.id)).toEqual(ORDER);
    expect(findAreaPage("travtrack")!.sections.map((s) => s.id)).toEqual(ORDER);
    expect(AREA_PAGES.filter((p) => p.id === "travtrack")).toHaveLength(1);
  });

  it("names every section in German and English", () => {
    for (const id of ORDER) {
      const key = SETTINGS_SECTIONS.find((s) => s.id === id)!.labelKey.replace("settings:", "");
      const at = (tree: unknown) =>
        key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], tree);
      expect(at(de), key).toBeTruthy();
      expect(at(en), key).toBeTruthy();
    }
  });

  it("hides Diagnose (Expert) at the standard level and shows it at expert", () => {
    const page = findAreaPage("travtrack")!;
    const at = (level: "standard" | "expert") =>
      sectionsOf(page, {
        level,
        isGateOpen: () => true,
        isAdmin: false,
        deepLinked: null,
        conditions: { travTrackHeld: true },
      });
    expect(at("standard").shown).toEqual(ORDER.filter((id) => id !== "ttDiag"));
    expect(at("standard").hiddenExpert).toBe(1);
    expect(at("expert").shown).toEqual(ORDER);
  });

  it("keeps the data sections off the page when TravTrack holds nothing, bar Aufzeichnung and Erkennung", () => {
    const page = findAreaPage("travtrack")!;
    const shown = sectionsOf(page, {
      level: "expert",
      isGateOpen: () => true,
      isAdmin: false,
      deepLinked: null,
      conditions: { travTrackHeld: false },
    }).shown;
    expect(shown).toEqual(["ttRecording", "ttDetect"]);
  });
});

import { describe, expect, it } from "vitest";
import { pageReachable, sectionsOf } from "../../surface";
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

const TT_PAGES = ["tt-aufz", "tt-erk", "tt-daten"] as const;
/** The admin's "Bereitstellung" pages sit in the same areas (settings v3 S4). */
const TT_MENU = [...TT_PAGES, "tt-bereit"] as const;
const mountsOnTravTrackPages = (): string[] =>
  TT_PAGES.flatMap((id) => findAreaPage(id)!.sections.map((s) => s.id));

describe("the TravTrack settings pages", () => {
  it("are the menu's TravTrack area, in both languages", () => {
    expect(AREA_MENU.find((g) => g.id === "track")!.pages).toEqual([...TT_MENU]);
    expect(findAreaPage("location")).toBeUndefined();
    expect(de.area.menu.track).toBe("TravTrack");
    expect(en.area.menu.track).toBe("TravTrack");
    for (const id of [...TT_MENU, "pl-bereit"] as const) {
      expect(de.area.pages[id], id).toBeTruthy();
      expect(en.area.pages[id], id).toBeTruthy();
    }
    expect(Object.keys(de.area.pages)).not.toContain("location");
  });

  it("hold the eight sections in the spec's order, in the registry and on the pages", () => {
    const rows = TT_PAGES.flatMap((id) => registryPage(id)!.sections.flatMap((s) => s.rows));
    expect([...new Set(rows.map((r) => r.mount))]).toEqual(ORDER);
    expect(mountsOnTravTrackPages()).toEqual(ORDER);
    expect(AREA_PAGES.filter((p) => p.area === "track")).toHaveLength(4);
  });

  it("name every section in German and English", () => {
    for (const id of ORDER) {
      const key = SETTINGS_SECTIONS.find((s) => s.id === id)!.labelKey.replace("settings:", "");
      const at = (tree: unknown) =>
        key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], tree);
      expect(at(de), key).toBeTruthy();
      expect(at(en), key).toBeTruthy();
    }
  });

  it("hide Diagnose (Expert) at the standard level and show it at expert", () => {
    const at = (level: "standard" | "expert") =>
      TT_PAGES.flatMap(
        (id) =>
          sectionsOf(findAreaPage(id)!, {
            level,
            isGateOpen: () => true,
            isAdmin: false,
            deepLinked: null,
            conditions: { travTrackHeld: true, locationSourceHeld: true },
          }).shown
      );
    expect(at("standard")).toEqual(ORDER.filter((id) => id !== "ttDiag"));
    expect(at("expert")).toEqual(ORDER);
  });

  it("are not offered at all while the server does not offer TravTrack and the account holds nothing", () => {
    const conditions = { travTrackHeld: false, locationSourceHeld: false };
    for (const id of TT_PAGES) {
      const page = findAreaPage(id)!;
      expect(pageReachable(page, conditions), id).toBe(false);
      expect(pageReachable(page, { travTrackHeld: true, locationSourceHeld: true }), id).toBe(true);
      expect(
        sectionsOf(page, {
          level: "expert",
          isGateOpen: () => true,
          isAdmin: false,
          deepLinked: null,
          conditions,
        }).shown,
        id
      ).toEqual([]);
    }
  });
});

describe("the TravTrack pages for an account on Dawarich alone", () => {
  // The server does not offer TravTrack and the account holds none of its data,
  // but its location source is Dawarich (or it has its own Dawarich connection).
  const conditions = { travTrackHeld: false, locationSourceHeld: true };
  const shown = (id: (typeof TT_PAGES)[number]): string[] =>
    sectionsOf(findAreaPage(id)!, {
      level: "expert",
      isGateOpen: () => true,
      isAdmin: false,
      deepLinked: null,
      conditions,
    }).shown;

  it("keep the source choice and the stay search reachable, and nothing that needs TravTrack", () => {
    expect(shown("tt-aufz")).toEqual(["ttRecording"]);
    expect(shown("tt-erk")).toEqual(["ttDetect"]);
    expect(shown("tt-daten")).toEqual([]);
    expect(pageReachable(findAreaPage("tt-aufz")!, conditions)).toBe(true);
    expect(pageReachable(findAreaPage("tt-erk")!, conditions)).toBe(true);
    expect(pageReachable(findAreaPage("tt-daten")!, conditions)).toBe(false);
  });
});

describe("the TravPlan settings page", () => {
  it("shows only where the instance offers TravPlan", () => {
    const page = findAreaPage("pl-plan")!;
    expect(AREA_MENU.find((g) => g.id === "plan")!.pages).toEqual(["pl-plan", "pl-bereit"]);
    expect(pageReachable(page, { travPlanOffered: false })).toBe(false);
    expect(pageReachable(page, { travPlanOffered: true })).toBe(true);
  });
});

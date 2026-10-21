import { describe, it, expect } from "vitest";
import { SETTINGS_MENU, SETTINGS_PAGES } from "../Settings/settingsModel";
import { ADMIN_MENU, ADMIN_PAGES } from "../Admin/adminSections";

// The tester saw the left menu highlight jump to an unrelated entry while
// scrolling the old "Allgemein" page, because the menu and the page read two
// different orders. Since forgejo#321 a menu entry is a page, and the page and
// its chips read the page's own `sections` — one list. What is left to pin is
// the menu itself: every page once, in the order the owner set.
describe("settings menu order", () => {
  it("lists the personal pages in the owner's order: account first, then domains, then data", () => {
    expect(SETTINGS_MENU.flatMap((g) => g.pages)).toEqual([
      "account",
      "display",
      "trips",
      "location",
      "loyalty",
      "flight",
      "cruise",
      "data",
      "services",
    ]);
  });

  it("lists every personal and admin page exactly once", () => {
    const personal = SETTINGS_MENU.flatMap((g) => g.pages);
    expect([...personal].sort()).toEqual(SETTINGS_PAGES.map((p) => p.id).sort());
    const admin = ADMIN_MENU.flatMap((g) => g.pages);
    expect([...admin].sort()).toEqual(ADMIN_PAGES.map((p) => p.id).sort());
  });

  it("groups administration as decided: Verwaltung, Dienste & Betrieb, master data per domain", () => {
    expect(ADMIN_MENU.map((g) => [g.id, [...g.pages]])).toEqual([
      ["manage", ["instance", "users", "invitations"]],
      [
        "operations",
        ["externalServices", "parsers", "smtp", "backups", "timeModel", "logging", "system"],
      ],
      ["masterFlight", ["airlinesMasterData", "aircraftMasterData", "airportsMasterData"]],
      ["masterCruise", ["shipsMasterData", "portsMasterData"]],
    ]);
  });

  it("gives every section exactly one home on each surface", () => {
    for (const pages of [SETTINGS_PAGES, ADMIN_PAGES]) {
      const ids = pages.flatMap((p) => p.sections.map((s) => s.id as string));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES, findPage } from "../settingsModel";
import { ADMIN_PAGES, findAdminPage } from "../../Admin/adminSections";
import { pageLevel, sectionsOf, type PageDef } from "../surface";

/**
 * The Standard/Expert classification the owner decided on 2026-10-20
 * (forgejo#321, first comment), as data. A section moving level is a product
 * decision, so it has to show up here as a changed line, not slip in with a
 * layout change.
 */
const EXPERT_SECTIONS = {
  settings: ["apitokens", "countryCounting", "defaults", "enrichment"],
  admin: [
    // "geocoder" left this list as a section, not as a level: its two
    // addresses are expert rows of Externe Dienste › Karten & Ortssuche now
    // (forgejo#321 prototype), counted by that section's expert rows.
    "federation",
    "push",
    "templateRepo",
    "timeModel",
    "logging",
    "system",
    "airlinesMasterData",
    "aircraftMasterData",
    "airportsMasterData",
    "shipsMasterData",
    "portsMasterData",
    "lodgingChainsMasterData",
  ],
};

const expertOf = (pages: readonly PageDef[]): string[] =>
  pages.flatMap((p) => p.sections.filter((s) => s.level === "expert").map((s) => s.id));

const shownAt = (page: PageDef, level: "standard" | "expert", deepLinked: string | null = null) =>
  sectionsOf(page, { level, isGateOpen: () => true, isAdmin: true, deepLinked });

describe("the standard/expert classification", () => {
  it("marks exactly the decided sections as expert", () => {
    expect(expertOf(SETTINGS_PAGES).sort()).toEqual([...EXPERT_SECTIONS.settings].sort());
    expect(expertOf(ADMIN_PAGES).sort()).toEqual([...EXPERT_SECTIONS.admin].sort());
  });

  it("leaves every personal page something at the standard level", () => {
    for (const page of SETTINGS_PAGES) expect(pageLevel(page), page.id).toBe("standard");
  });

  it("makes the operations and master-data pages expert as a whole", () => {
    const expertPages = ADMIN_PAGES.filter((p) => pageLevel(p) === "expert").map((p) => p.id);
    expect(expertPages.sort()).toEqual(
      [
        "timeModel",
        "logging",
        "system",
        "airlinesMasterData",
        "aircraftMasterData",
        "airportsMasterData",
        "shipsMasterData",
        "portsMasterData",
        "lodgingChainsMasterData",
      ].sort()
    );
  });

  // "Standard never hides a setting a flow needs to finish."
  it.each([
    ["account", ["profile", "security", "devices", "notifications"]],
    ["display", ["display", "units", "domains"]],
    ["trips", ["trips", "suggestions", "sharing", "shareLinks"]],
    // The stay scan is standard; detecting places as areas just runs, and its
    // two switches are expert rows inside it (forgejo#318).
    ["location", ["dawarich", "tripRecording", "stayScan"]],
    ["loyalty", ["loyalty"]],
    ["flight", ["homeAirport", "autoupdate", "features"]],
    ["cruise", ["cruisePreferences"]],
    ["data", ["backup", "import"]],
    ["services", ["externalServices"]],
  ])("keeps the flow sections of %s at the standard level", (pageId, ids) => {
    expect(shownAt(findPage(pageId)!, "standard").shown).toEqual(expect.arrayContaining(ids));
  });

  it.each([
    ["instance", ["instance", "shareLinks", "importMode", "usageStats", "about"]],
    ["users", ["users"]],
    ["invitations", ["invitations"]],
    ["externalServices", ["externalServices"]],
    ["parsers", ["parsers"]],
    ["smtp", ["smtp"]],
    ["backups", ["backups", "webdav"]],
  ])("keeps the admin flow sections of %s at the standard level", (pageId, ids) => {
    expect(shownAt(findAdminPage(pageId)!, "standard").shown).toEqual(ids);
  });
});

describe("level filtering", () => {
  const account = findPage("account")!;
  const instance = findAdminPage("instance")!;

  it("hides only expert sections at the standard level, and counts them", () => {
    const standard = shownAt(account, "standard");
    expect(standard.shown).not.toContain("apitokens");
    expect(standard.hiddenExpert).toBe(1);
    expect(shownAt(instance, "standard").hiddenExpert).toBe(2);
  });

  // forgejo#321 prototype: the note counts settings, not sections.
  it("counts the settings the hidden expert sections hold", () => {
    expect(shownAt(findPage("flight")!, "standard").hiddenExpertSettings).toBe(4 + 3);
    expect(shownAt(instance, "standard").hiddenExpertSettings).toBe(3 + 1);
    expect(shownAt(instance, "expert").hiddenExpertSettings).toBe(0);
  });

  it("hides nothing at the expert level", () => {
    const expert = shownAt(account, "expert");
    expect(expert.shown).toEqual(account.sections.map((s) => s.id));
    expect(expert.hiddenExpert).toBe(0);
  });

  it("shows an expert section a link names, and says it is one", () => {
    const linked = shownAt(account, "standard", "apitokens");
    expect(linked.shown).toContain("apitokens");
    expect(linked.deepLinkedExpert).toBe("apitokens");
    expect(linked.hiddenExpert).toBe(0);
  });

  it("lets a link lift the device-pairing gate, and no other", () => {
    const closed = (deepLinked: string | null) =>
      sectionsOf(account, { level: "expert", isGateOpen: () => false, isAdmin: false, deepLinked });
    expect(closed(null).shown).not.toContain("devices");
    expect(closed("devices").shown).toContain("devices");
  });
});

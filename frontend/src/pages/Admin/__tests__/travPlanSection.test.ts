import { describe, it, expect } from "vitest";
import { ADMIN_SECTION_LABEL_KEY } from "../adminSections";
import { ADMIN_SECTION_FRAME } from "../AdminSectionSwitch";
import { findAreaPage } from "../../Settings/area/areaModel";
import { searchArea } from "../../Settings/area/areaSearch";
import { SETTINGS_REGISTRY } from "../../Settings/registry";
import { sectionsOf } from "../../Settings/surface";

/**
 * The server's TravPlan switch (owner, 2026-10-26): "erst sichtbar mit aktiven
 * Beta Schalter" — it exists only while the `travPlan` beta key is open, on the
 * Server page and in the settings search alike.
 */
const server = findAreaPage("server")!;
const shown = (open: string[]) =>
  sectionsOf(server, {
    level: "standard",
    isGateOpen: (key) => open.includes(key),
    isAdmin: true,
    deepLinked: null,
  }).shown;

const searchIds = (open: string[]): string[] =>
  searchArea(
    "planen",
    SETTINGS_REGISTRY,
    { isAdmin: true, isDomainOn: () => true, isGateOpen: (key) => open.includes(key) },
    "de"
  ).hits.map((h) => `${h.pageId}/${h.sectionId}`);

describe("the TravPlan server section", () => {
  it("sits next to TravTrack on the Server page, framed by itself", () => {
    const ids = server.sections.map((s) => s.id);
    expect(ids.indexOf("travPlan")).toBe(ids.indexOf("features") + 1);
    expect(ADMIN_SECTION_LABEL_KEY.travPlan).toBe("admin:travPlan.title");
    expect(ADMIN_SECTION_FRAME.travPlan).toBe("own");
  });

  it("is hidden while the travPlan beta key is closed, and shown once it is open", () => {
    expect(shown([])).not.toContain("travPlan");
    expect(shown(["travTrack"])).not.toContain("travPlan");
    expect(shown(["travPlan"])).toContain("travPlan");
  });

  it("is found by the search only while the beta key is open", () => {
    expect(searchIds([]).some((id) => id.startsWith("domains/planning"))).toBe(false);
    expect(searchIds(["travPlan"]).some((id) => id.startsWith("domains/planning"))).toBe(true);
  });
});

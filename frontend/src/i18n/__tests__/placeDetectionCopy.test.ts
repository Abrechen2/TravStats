import { describe, it, expect } from "vitest";

import deTrips from "../resources/de/trips.json";
import enTrips from "../resources/en/trips.json";
import deSettings from "../resources/de/settings.json";
import enSettings from "../resources/en/settings.json";
import { searchSettings, splitKeywords } from "../../pages/Settings/settingsSearchMatch";
import { findPage } from "../../pages/Settings/settingsModel";

/**
 * forgejo#318: the detection is named for what it does, not for markets
 * (owner, 2026-10-20: „muss nicht so genannt werden"). It finds markets,
 * malls, parks, zoos and museums as whole areas.
 */
describe("detecting places automatically — the wording", () => {
  it("is called „Orte automatisch erkennen“ / “Detect places automatically”", () => {
    expect(deTrips.dawarichStays.areas.title).toBe("Orte automatisch erkennen");
    expect(enTrips.dawarichStays.areas.title).toBe("Detect places automatically");
  });

  it("no longer offers „Marktbesuche“ as the switch's name", () => {
    expect(deTrips.dawarichStays.markets.enable).not.toMatch(/Marktbesuch/);
    expect(enTrips.dawarichStays.markets.enable).not.toMatch(/market visits/i);
  });

  it("says where positions go in both languages", () => {
    expect(deTrips.dawarichStays.areas.description).toMatch(/OpenStreetMap/);
    expect(enTrips.dawarichStays.areas.description).toMatch(/OpenStreetMap/);
  });
});

/**
 * The market and venue switches are standard rows of the stay scan since the
 * settings redesign (package 3): they choose which content is examined. Their
 * words are ordinary keywords, and the section no longer claims expert rows.
 */
describe("searching for the detection's switches", () => {
  const candidate = (s: typeof deSettings) => ({
    section: "stayScan",
    label: "stays",
    groupLabel: "location",
    href: "/settings/location",
    keywords: splitKeywords(s.search.keywords.stayScan),
    expertKeywords: splitKeywords(
      (s.search.expertKeywords as Record<string, string>).stayScan ?? ""
    ),
  });

  it("the stay scan has no expert rows left", () => {
    const def = findPage("location")!.sections.find((x) => x.id === "stayScan")!;
    expect(def.expertRows).toBeFalsy();
  });

  it.each([
    ["de", deSettings, "Märkte"],
    ["en", enSettings, "markets"],
  ] as const)("%s: a word for a switch is an ordinary hit", (_l, s, word) => {
    const [hit] = searchSettings(word, [candidate(s)]);
    expect(hit?.expertOnly).toBe(false);
  });

  it.each([
    ["de", deSettings, "Orte automatisch erkennen"],
    ["en", enSettings, "detect places automatically"],
  ] as const)("%s: the detection's name is an ordinary hit", (_l, s, word) => {
    const [hit] = searchSettings(word, [candidate(s)]);
    expect(hit?.expertOnly).toBe(false);
  });
});

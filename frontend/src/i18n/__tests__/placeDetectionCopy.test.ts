import { describe, it, expect } from "vitest";

import deTrips from "../resources/de/trips.json";
import enTrips from "../resources/en/trips.json";
import deSettings from "../resources/de/settings.json";
import enSettings from "../resources/en/settings.json";
import { searchSettings, splitKeywords } from "../../pages/Settings/settingsSearchMatch";
import { WITH_EXPERT_ROWS } from "../../pages/Settings/useSearchScopes";

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
 * The search finds an expert setting at every level and marks the hit
 * „· Experte“ (forgejo#321's model): the area switches are expert rows of the
 * stay scan, so their words are expert keywords, and the section's own
 * words are not.
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

  it("searches the stay scan's expert words at all", () => {
    expect(WITH_EXPERT_ROWS?.has("settings:stayScan")).toBe(true);
  });

  it.each([
    ["de", deSettings, "Märkte"],
    ["en", enSettings, "markets"],
  ] as const)("%s: a word for a switch is an expert hit", (_l, s, word) => {
    const [hit] = searchSettings(word, [candidate(s)]);
    expect(hit?.expertOnly).toBe(true);
  });

  it.each([
    ["de", deSettings, "Orte automatisch erkennen"],
    ["en", enSettings, "detect places automatically"],
  ] as const)("%s: the detection's name is an ordinary hit", (_l, s, word) => {
    const [hit] = searchSettings(word, [candidate(s)]);
    expect(hit?.expertOnly).toBe(false);
  });
});

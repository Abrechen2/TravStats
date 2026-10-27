import { describe, expect, it } from "vitest";
import deStats from "../resources/de/stats.json";
import enStats from "../resources/en/stats.json";
import deEvidence from "../resources/de/evidence.json";
import enEvidence from "../resources/en/evidence.json";
import deTrack from "../resources/de/track.json";
import enTrack from "../resources/en/track.json";
import deAchievements from "../resources/de/achievements.json";
import enAchievements from "../resources/en/achievements.json";

/**
 * forgejo#299: "visited" is the passport's word. A visit is a stay beyond a
 * stopover, and only the passport rule decides it. These figures count every
 * country a flight touched or a ship called at, connections included, so they
 * must not claim a visit. One was labelled "Besuchte Länder" while counting
 * Doha for MUC→DOH→HAN.
 */
const NOT_PASSPORT: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
  ["airportStats.countryCount", deStats, enStats, "flight tile"],
  ["cruiseSection.countriesLabel", deStats, enStats, "cruise tag cloud"],
  ["evidence.metric.flightCountriesVisitedCount", deEvidence, enEvidence, "flight metric"],
  ["evidence.metric.continentsVisitedCount", deEvidence, enEvidence, "continent metric"],
  ["unique.continentalExplorerDesc", deStats, enStats, "continents a flight touched"],
  ["map.layers.countriesHint", deTrack, enTrack, "location-history countries"],
];

/**
 * Every badge that speaks of countries or continents. The cross-domain ones
 * (`COUNTRIES_*`, `CONTINENTS_*`) read the passport's ground-contact set
 * (owner ruling 2026-08-09, "count every country set foot in"); the domain
 * ones count by their own rule — a house, a station, a place, a planned
 * flight. Neither is the passport's "Land besucht", so neither may say it.
 */
const COUNTRY_BADGE =
  /^(COUNTRIES_|CONTINENTS_|PLACE_COUNTRIES|PLACE_CONTINENTS|LODGING_CONTINENTS|BORDER_CROSSER|RAIL_COUNTRIES|ROADTRIP_COUNTRIES|GLOBETROTTER_PLANNER)/;
const badgeCodes = (tree: Record<string, unknown>): string[] =>
  Object.keys((tree.codes ?? {}) as Record<string, unknown>).filter((code) =>
    COUNTRY_BADGE.test(code)
  );

function read(tree: Record<string, unknown>, key: string): string {
  if (key in tree) return String(tree[key]);
  return String(
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree)
  );
}

describe("country figures outside the passport do not say visited", () => {
  it.each(NOT_PASSPORT)("%s (%s)", (key, de, en) => {
    expect(read(de, key)).not.toMatch(/besucht/i);
    expect(read(en, key)).not.toMatch(/visited/i);
  });
});

describe("badges that count countries or continents do not say visited", () => {
  it("finds the badges it guards", () => {
    expect(badgeCodes(deAchievements).length).toBeGreaterThanOrEqual(20);
    expect(badgeCodes(enAchievements).sort()).toEqual(badgeCodes(deAchievements).sort());
  });

  it.each(badgeCodes(deAchievements))("%s", (code) => {
    expect(read(deAchievements, `codes.${code}.description`)).not.toMatch(/besuch/i);
    expect(read(enAchievements, `codes.${code}.description`)).not.toMatch(/visit/i);
  });
});

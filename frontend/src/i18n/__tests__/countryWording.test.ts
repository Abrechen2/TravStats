import { describe, expect, it } from "vitest";
import deStats from "../resources/de/stats.json";
import enStats from "../resources/en/stats.json";
import deEvidence from "../resources/de/evidence.json";
import enEvidence from "../resources/en/evidence.json";

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
];

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

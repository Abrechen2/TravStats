import { describe, it, expect } from "vitest";
import { statsSectionsFor } from "../statsSections";
import deStats from "../../../i18n/resources/de/stats.json";
import deCruise from "../../../i18n/resources/de/cruise.json";
import deLodging from "../../../i18n/resources/de/lodging.json";
import dePlaces from "../../../i18n/resources/de/places.json";
import enStats from "../../../i18n/resources/en/stats.json";
import enCruise from "../../../i18n/resources/en/cruise.json";
import enLodging from "../../../i18n/resources/en/lodging.json";
import enPlaces from "../../../i18n/resources/en/places.json";

const TABS = ["all", "flight", "cruise", "lodging", "poi"] as const;

type Tree = { [key: string]: unknown };
const LOCALES: Record<string, Record<string, Tree>> = {
  de: { stats: deStats, cruise: deCruise, lodging: deLodging, places: dePlaces },
  en: { stats: enStats, cruise: enCruise, lodging: enLodging, places: enPlaces },
};

/** The real copy, looked up the way i18next would — or undefined. */
function lookup(locale: string, key: string): unknown {
  const [ns, path] = key.split(":");
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Tree)[part] : undefined),
      LOCALES[locale][ns]
    );
}

const t = (key: string): string => key;

describe("statsSectionsFor", () => {
  it.each(TABS)("offers blocks for the %s tab", (tab) => {
    expect(statsSectionsFor(tab, t).length).toBeGreaterThan(0);
  });

  it.each(TABS)("gives every block of the %s tab its own key", (tab) => {
    // One stored key hiding two blocks the reader never linked is a switch
    // that does more than its label says.
    const keys = statsSectionsFor(tab, t).map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // A missing key is silent: react-i18next draws the key itself as the label.
  // And a heading reused as a label can carry a placeholder the menu never
  // fills — the heatmap's title is "Aktive Tage {{year}}".
  it.each(TABS)("labels every block of the %s tab with real copy in both languages", (tab) => {
    for (const { label: key } of statsSectionsFor(tab, t)) {
      for (const locale of ["de", "en"]) {
        const copy = lookup(locale, key);
        expect(typeof copy, `${locale} ${key}`).toBe("string");
        expect(copy as string, `${locale} ${key}`).not.toMatch(/\{\{/);
      }
    }
  });
});

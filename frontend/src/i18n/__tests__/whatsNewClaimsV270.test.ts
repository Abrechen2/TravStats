import { describe, it, expect } from "vitest";

import deWhatsNew from "../resources/de/whatsNew.json";
import enWhatsNew from "../resources/en/whatsNew.json";
import { GENERAL_GROUP_IDS, SETTINGS_GROUPS } from "../../pages/Settings/settingsModel";

/**
 * Auditor 3, 2026-09-19: three blocks of the 2.7.0 announcement described an
 * app that does not exist. An announcement is read once, by everybody, and it
 * is the only place most readers ever learn what changed — a claim that is
 * wrong there sends people looking for something that is not there, and they
 * conclude the feature is broken rather than that the sentence was.
 *
 * Each case asserts the ABSENCE of the wrong claim, and names what the code
 * says instead. The rule is not the new wording; it is that the sentence must
 * not contradict the app.
 */
const bodies = (block: "design" | "toursAndSummary" | "placesPassport"): [string, string][] => [
  [`de ${block}`, deWhatsNew.entries.v270[block].body],
  [`en ${block}`, enWhatsNew.entries.v270[block].body],
];

describe("the 2.7.0 announcement describes the app that shipped", () => {
  /**
   * `settingsModel.ts`: four of the seven groups — account, display, data,
   * services — are ANCHORS on one page (`GENERAL_GROUP_IDS`), and only the
   * domain groups are routes. "jede mit eigener Adresse" was true of three.
   */
  it.each(bodies("design"))("%s does not claim every settings group is a route", (_n, body) => {
    expect(GENERAL_GROUP_IDS.length).toBeGreaterThan(1);
    expect(GENERAL_GROUP_IDS.length).toBeLessThan(SETTINGS_GROUPS.length);
    expect(body).not.toMatch(/jede mit eigener Adresse|each with its own address/i);
  });

  /**
   * Tours are a TAB on the trip (`TripDetailPage`'s `TABS`, with its own
   * route editor), not rows in the Timeline tab.
   */
  it.each(bodies("toursAndSummary"))("%s does not put tours in the journal", (_n, body) => {
    expect(body).not.toMatch(/Abschnitte im Reisejournal|legs in the trip journal/i);
  });

  /**
   * The Orte import is a CSV import that also swallows a Takeout export
   * (`places:import.csv`). It does not read saved Google Maps lists; the
   * dedicated Takeout entry belongs to Unterkünfte.
   */
  it.each(bodies("placesPassport"))("%s does not promise a Google Maps import", (_n, body) => {
    expect(body).not.toMatch(/Google-Maps-Listen|Google Maps lists/i);
  });

  it.each([
    ["design", "de"],
    ["design", "en"],
    ["toursAndSummary", "de"],
    ["toursAndSummary", "en"],
    ["placesPassport", "de"],
    ["placesPassport", "en"],
  ] as const)("%s (%s) is still a real paragraph", (block, locale) => {
    const source = locale === "de" ? deWhatsNew : enWhatsNew;
    expect(source.entries.v270[block].body.length).toBeGreaterThan(120);
  });
});

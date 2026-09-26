import { describe, it, expect } from "vitest";

import deWhatsNew from "../resources/de/whatsNew.json";
import enWhatsNew from "../resources/en/whatsNew.json";
import { GENERAL_GROUP_IDS, SETTINGS_GROUPS } from "../../pages/Settings/settingsModel";
import { BETA_FEATURES } from "../../config/betaFeatures";

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
const bodies = (block: "design" | "summaryOpenData" | "placesPassport"): [string, string][] => [
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
   * 2026-09-26: the announcement still said "tours are released" and "only app
   * pairing is beta" two days after the owner put tours and roadtrips back
   * behind the switch (24.09.) and rail went in behind it (25.09.). Tours are
   * under the `roadtrips` key; the released block must not claim them.
   */
  it.each(bodies("summaryOpenData"))("%s does not call tours released", (_n, body) => {
    expect(body).not.toMatch(/Touren|tours/i);
  });

  /**
   * The beta block must name every feature the registry holds — a key added
   * to `BETA_FEATURES` without a word here is exactly the drift above. The
   * keyword per key is what a reader would look for on the page.
   */
  const betaKeyword: Record<keyof typeof BETA_FEATURES, [RegExp, RegExp]> = {
    devicePairing: [/Companion/, /Companion/],
    roadtrips: [/Roadtrips.*Tagestouren/, /Roadtrips.*day tours/],
    lodgingEnrichment: [/Hotel-Anreicherung/, /hotel enrichment/],
    railDomain: [/Bahn/, /rail/],
  };
  it.each(Object.keys(BETA_FEATURES) as (keyof typeof BETA_FEATURES)[])(
    "the beta block names the registered beta feature %s",
    (key) => {
      const [de, en] = betaKeyword[key];
      expect(deWhatsNew.entries.v270.beta.body).toMatch(de);
      expect(enWhatsNew.entries.v270.beta.body).toMatch(en);
    }
  );

  it.each([
    ["de", deWhatsNew],
    ["en", enWhatsNew],
  ] as const)("the %s beta block does not claim pairing is the only beta", (_l, source) => {
    expect(source.entries.v270.beta.title).not.toMatch(/Nur noch|Only/i);
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
    ["summaryOpenData", "de"],
    ["summaryOpenData", "en"],
    ["placesPassport", "de"],
    ["placesPassport", "en"],
  ] as const)("%s (%s) is still a real paragraph", (block, locale) => {
    const source = locale === "de" ? deWhatsNew : enWhatsNew;
    expect(source.entries.v270[block].body.length).toBeGreaterThan(120);
  });
});

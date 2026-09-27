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
    cruiseTracks: [/Spuren bei Kreuzfahrten/, /tracks on cruises/],
  };
  it.each(Object.keys(BETA_FEATURES) as (keyof typeof BETA_FEATURES)[])(
    "the beta block names the registered beta feature %s",
    (key) => {
      const [de, en] = betaKeyword[key];
      expect(deWhatsNew.entries.v270.beta.body).toMatch(de);
      expect(enWhatsNew.entries.v270.beta.body).toMatch(en);
    }
  );

  /**
   * 2026-09-26, later the same day: the tester said what he needs — each
   * programme with its number and today's status, managed centrally in the
   * settings, nights/stays per programme with the list behind them, and NO
   * history of when a status was reached. The owner released that and dropped
   * the gate (`loyaltyCenter` is gone from the registry). So the released
   * block announces it where it lives, the beta block no longer does, and no
   * block promises a status history the app does not have.
   */
  it("keeps no loyalty gate in the registry", () => {
    expect(Object.keys(BETA_FEATURES)).not.toContain("loyaltyCenter");
  });

  it.each([
    ["de", deWhatsNew, /Einstellungen → Bonusprogramme/, /Bonusprogramme/],
    ["en", enWhatsNew, /Settings → Loyalty programmes/, /loyalty programmes/i],
  ] as const)(
    "the released %s block announces the loyalty programmes where they live, the beta block not",
    (_l, source, where, name) => {
      expect(source.entries.v270.entrySuggestions.body).toMatch(where);
      expect(source.entries.v270.beta.title).not.toMatch(name);
      expect(source.entries.v270.beta.body).not.toMatch(name);
    }
  );

  it.each([
    ["de", deWhatsNew, /Statusverlauf|Status damals/],
    ["en", enWhatsNew, /status history|status then/i],
  ] as const)("no %s 2.7.0 block promises a status history", (_l, source, re) => {
    for (const block of Object.values(source.entries.v270)) {
      expect(block.title).not.toMatch(re);
      expect(block.body).not.toMatch(re);
    }
  });

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

  /**
   * 2026-09-27, before beta.16. Three things landed that a reader of the
   * released blocks must not be sent looking for, because they sit behind the
   * `roadtrips` / `railDomain` gates: the tours on a trip's map, the routing
   * section in Administration → Externe Dienste, and BahnBonus cards. They are
   * named in the beta block, and only there.
   */
  it.each([
    ["de", deWhatsNew],
    ["en", enWhatsNew],
  ] as const)("no released %s block names a gated tour, routing or rail feature", (_l, source) => {
    for (const [name, block] of Object.entries(source.entries.v270)) {
      if (name === "beta") continue;
      expect(block.body).not.toMatch(/Touren|\btours?\b|Routing|BahnBonus/i);
    }
    expect(source.entries.v270.beta.body).toMatch(/routing/i);
    expect(source.entries.v270.beta.body).toMatch(/BahnBonus/);
  });

  /**
   * The sea-route change (cruise legs measured along the drawn route instead of
   * falling back to the chord) moves every reader's cruise kilometres. A number
   * that changes without a word reads as a bug; the announcement says it.
   */
  it.each([
    ["de", deWhatsNew, /Kreuzfahrt-Kilometer[^.]*steigen/],
    ["en", enWhatsNew, /cruise kilometres[^.]*go up/],
  ] as const)("the %s announcement says cruise kilometres go up", (_l, source, re) => {
    expect(source.entries.v270.evidence.body).toMatch(re);
  });

  /**
   * The image now seeds the demo account on a first install, and that seed
   * switches the instance's beta features on (97edf80cc). An administrator of a
   * fresh instance must learn that from the announcement, not by surprise.
   */
  it.each([
    ["de", deWhatsNew, /Demo-Konto[^]*neue Installation[^.]*Beta-Schalter ein/],
    ["en", enWhatsNew, /demo account[^]*new installation[^.]*beta switch on/],
  ] as const)("the %s beta block says a new install turns beta on with the demo", (_l, s, re) => {
    expect(s.entries.v270.beta.body).toMatch(re);
  });

  /**
   * beta.17: the AI provider choice is released (admin settings, not gated), so
   * it is announced in a released block — and the announcement must not hide
   * that a cloud provider needs the admin's explicit consent.
   */
  it.each([
    ["de", deWhatsNew, /OpenAI-kompatibler KI-Anbieter[^.]*ausdrücklich zustimmt/],
    ["en", enWhatsNew, /OpenAI-compatible AI provider[^.]*explicitly agrees/],
  ] as const)("the %s announcement names the provider choice and its consent", (_l, s, re) => {
    expect(s.entries.v270.summaryOpenData.body).toMatch(re);
    expect(s.entries.v270.beta.body).not.toMatch(/OpenAI/);
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

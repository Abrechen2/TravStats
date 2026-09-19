import { describe, it, expect, beforeAll } from "vitest";
import i18n from "../../../i18n/config";
import { composeI18nText, EVIDENCE_TEXT_KEYS } from "../evidenceText";

/**
 * The one evidence test that runs the REAL translator.
 *
 * Every other test in this folder overrides `useTranslation` with a mock that
 * echoes the key, which is exactly the shape of the defect found in the
 * browser on 2026-09-19: the airport ranking rows read
 * "BCN → MUC · evidence.entry.role.arrival", because react-i18next renders a
 * missing key as its own name and a key-echoing mock cannot tell that apart
 * from a translation. So this file asks i18next itself.
 *
 * `i18n/config.ts` is imported rather than a hand-built instance on purpose —
 * `keySeparator`, `nsSeparator` and the namespace list are what decide whether
 * a key resolves, and a test that restated them would be testing its own copy
 * of the rule.
 */

type Translator = (key: string, options?: Record<string, unknown>) => string;
const translate: Translator = (key, options) => i18n.t(key, options);

const AIRPORT_SUBTITLE = {
  key: "evidence.ranking.airport.subtitle",
  values: { dep: "BCN", arr: "MUC", role: "arrival" },
};

describe("evidenceText against the real resources", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("de");
  });

  it("no key `evidenceText.ts` names resolves to itself, in either locale", async () => {
    // A key that resolves to itself IS the on-screen defect, not a proxy for
    // it — and the list comes from the module, so a fourth role added there
    // without its copy fails here on the day it is added.
    expect(EVIDENCE_TEXT_KEYS.length).toBeGreaterThan(0);
    for (const locale of ["de", "en"] as const) {
      await i18n.changeLanguage(locale);
      for (const key of EVIDENCE_TEXT_KEYS) {
        expect([locale, key, translate(key)]).not.toEqual([locale, key, key]);
      }
    }
  });

  it("an airport ranking row says 'Ankunft', not the role key", async () => {
    await i18n.changeLanguage("de");
    expect(composeI18nText(AIRPORT_SUBTITLE, translate)).toBe("BCN → MUC · Ankunft");
  });

  it("…and 'arrival' in English", async () => {
    await i18n.changeLanguage("en");
    expect(composeI18nText(AIRPORT_SUBTITLE, translate)).toBe("BCN → MUC · arrival");
  });

  it("the other two roles translate too", async () => {
    await i18n.changeLanguage("de");
    const de = (role: string): string =>
      composeI18nText(
        { ...AIRPORT_SUBTITLE, values: { ...AIRPORT_SUBTITLE.values, role } },
        translate
      );
    expect(de("departure")).toBe("BCN → MUC · Abflug");
    expect(de("both")).toBe("BCN → MUC · Abflug und Ankunft");
  });
});

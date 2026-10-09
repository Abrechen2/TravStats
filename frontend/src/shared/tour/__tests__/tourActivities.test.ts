import { describe, expect, it } from "vitest";

import deRoadtrips from "../../../i18n/resources/de/roadtrips.json";
import enRoadtrips from "../../../i18n/resources/en/roadtrips.json";
import { TOUR_ACTIVITIES } from "../roadtrip";

/**
 * A missing key is silent — react-i18next renders the key itself — so an
 * activity added to the vocabulary without its label would show
 * `roadtrips:activity.excursion` as copy in the tour list and editor.
 * DE/EN parity is `localeKeyParity.test.ts`'s job; this asks that every
 * activity HAS a label at all.
 */
describe("the label of every tour activity", () => {
  it.each([
    ["de", deRoadtrips],
    ["en", enRoadtrips],
  ])("exists in roadtrips.json (%s)", (_locale, roadtrips) => {
    const labels: Record<string, unknown> = roadtrips.activity;
    for (const activity of TOUR_ACTIVITIES) {
      expect(labels[activity], `roadtrips:activity.${activity}`).toEqual(expect.any(String));
      expect(String(labels[activity]).trim(), `roadtrips:activity.${activity}`).not.toBe("");
    }
  });
});

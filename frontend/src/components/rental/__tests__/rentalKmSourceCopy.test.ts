import { describe, expect, it } from "vitest";

import de from "../../../i18n/resources/de/rental.json";
import en from "../../../i18n/resources/en/rental.json";

/**
 * forgejo#262/#265: the km a rental counts come from the invoice, the rental
 * agreement, a correction by hand or both odometer readings
 * (`shared/rentalCounting.ts`, `rentalDrivenKm`). The copy that tells the
 * user where km come from — the form's hint and the statistics' empty line —
 * names every one of them, the agreement included.
 */
describe("rental km source copy", () => {
  it.each([
    ["de", de.form.distanceHint, /Mietvertrag/],
    ["en", en.form.distanceHint, /rental agreement/],
    ["de", de.stats.kmPerDayNone, /Mietvertrag/],
    ["en", en.stats.kmPerDayNone, /rental agreement/],
  ])("%s names the rental agreement: %s", (_lang, copy, agreement) => {
    expect(copy).toMatch(agreement);
  });
});

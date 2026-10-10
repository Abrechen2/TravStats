import { describe, expect, it } from "vitest";
import de from "../resources/de/stats.json";
import en from "../resources/en/stats.json";

/**
 * Time in port (forgejo#257). `foldPortStays` counts a call as inconsistent
 * when its departure is AT or before its arrival (`minutes <= 0`): a stay of
 * zero minutes is no stay. The footer said "before" only, so a reader whose
 * call read 08:00–08:00 was told it did not exist in that bucket.
 */
describe("time-in-port coverage copy says what the fold excludes", () => {
  const footer = {
    de: de.insights.cruise.stays.coverage,
    en: en.insights.cruise.stays.coverage,
  };
  const help = {
    de: de.insights.help.cruiseStays.coverage,
    en: en.insights.help.cruiseStays.coverage,
  };

  it("names an equal departure and arrival as excluded, in both languages", () => {
    expect(footer.de).toContain("zur oder vor der Ankunft");
    expect(footer.en).toContain("at or before the arrival");
    expect(help.de).toContain("vor oder zur Ankunft");
    expect(help.en).toContain("at or before the arrival");
  });

  it("never claims only an earlier departure is left out", () => {
    expect(footer.de).not.toMatch(/Abfahrt vor der Ankunft/);
    expect(footer.en).not.toMatch(/leaving before arriving/);
  });
});

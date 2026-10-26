import { describe, expect, it } from "vitest";
import type { DawarichStay } from "../../../../lib/api/dawarichStays";
import type { LocationSuggestion } from "../../../../lib/api/locationSuggestions";
import { countrySectionProps, staySectionProps } from "../sectionProps";

/** The count a card shows is the one its question names (beta.29 UAT). */
describe("sectionProps — the question's own position count", () => {
  it("a country question hands over its points on the ground", () => {
    const q = {
      window: { fromMs: 0, untilMs: 86_400_000 },
      coverage: "complete",
      explanation: { code: "country.groundDays", params: { country: "AT", days: 1, points: 6764 } },
    } as unknown as LocationSuggestion;
    expect(countrySectionProps(q, "Österreich").pointCount).toBe(6764);
  });

  it("a country question without a count leaves it to the drawn section", () => {
    const q = {
      window: { fromMs: 0, untilMs: 86_400_000 },
      coverage: null,
      explanation: { code: "country.groundDays", params: { country: "AT" } },
    } as unknown as LocationSuggestion;
    expect(countrySectionProps(q, "Österreich").pointCount).toBeNull();
  });

  it("a TravTrack stay hands over its point count", () => {
    const row = {
      startAt: "2026-10-01T12:00:00Z",
      endAt: "2026-10-01T18:00:00Z",
      zone: "UTC",
      lat: 48,
      lon: 11,
      pointCount: 214,
      evidence: { source: "travtrack", zone: "UTC", maxGapMinutes: 0, uncertainties: [] },
    } as unknown as DawarichStay;
    expect(staySectionProps(row)?.pointCount).toBe(214);
  });
});

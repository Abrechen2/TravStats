import { describe, it, expect } from "vitest";
import { formatKm, formatNumber } from "../../../../lib/format";

/**
 * The thousands separator follows the READER, not the repository.
 *
 * This helper came over from the globe card, which hardcoded `de-DE` when the
 * globe was a German-first surface. It governs the flat map's card too now,
 * where the card it replaced (`MapTooltip`) used `toLocaleString(locale)` off
 * `useLocale()`. An English reader saw "3.931 km", which in their own
 * convention is not 3931 but 3.9.
 */
describe("formatKm follows the reader's locale", () => {
  it("groups the German way for a German reader", () => {
    expect(formatNumber(3931, undefined, "de")).toBe("3.931");
  });

  it("groups the English way for an English reader", () => {
    expect(formatNumber(3931, undefined, "en")).toBe("3,931");
  });

  it("leaves a figure under a thousand ungrouped in either", () => {
    expect(formatNumber(931, undefined, "en")).toBe("931");
    expect(formatNumber(931, undefined, "de")).toBe("931");
  });

  it("carries the locale and unit through formatKm", () => {
    expect(formatKm(3931, { language: "en", unit: "kilometers" })).toBe("3,931 km");
  });
});

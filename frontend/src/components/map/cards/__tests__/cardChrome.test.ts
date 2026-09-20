import { describe, it, expect } from "vitest";
import { formatKm, formatKmNumber } from "../cardChrome";

/**
 * The thousands separator follows the READER, not the repository.
 *
 * This helper came over from the globe card, which hardcoded `de-DE` when the
 * globe was a German-first surface. It governs the flat map's card too now,
 * where the card it replaced (`MapTooltip`) used `toLocaleString(locale)` off
 * `useLocale()`. An English reader saw "3.931 km", which in their own
 * convention is not 3931 but 3.9.
 */
describe("formatKmNumber follows the reader's locale", () => {
  it("groups the German way for a German reader", () => {
    expect(formatKmNumber(3931, "de")).toBe("3.931");
  });

  it("groups the English way for an English reader", () => {
    expect(formatKmNumber(3931, "en")).toBe("3,931");
  });

  it("leaves a figure under a thousand ungrouped in either", () => {
    expect(formatKmNumber(931, "en")).toBe("931");
    expect(formatKmNumber(931, "de")).toBe("931");
  });

  it("carries the locale through formatKm's unit form", () => {
    expect(formatKm(3931, "en")).toBe("3,931 km");
  });
});

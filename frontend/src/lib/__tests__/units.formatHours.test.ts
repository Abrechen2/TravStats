import { describe, it, expect } from "vitest";
import { formatHours } from "../units";

// CT106 design-6 R09: the statistics printed one flight time four ways —
// "2 h" on the overview card, "1.5 h" on a German page, "64 h" on the
// scorecard and "374.7h" in the airline breakdown.
describe("formatHours", () => {
  it("keeps one decimal in the reader's language", () => {
    expect(formatHours(1.5, "de")).toBe("1,5 h");
    expect(formatHours(1.5, "en")).toBe("1.5 h");
  });

  it("drops a trailing zero instead of printing 64,0", () => {
    expect(formatHours(64, "de")).toBe("64 h");
  });

  it("groups thousands like every other figure on the page", () => {
    expect(formatHours(1234.56, "de")).toBe("1.234,6 h");
  });
});

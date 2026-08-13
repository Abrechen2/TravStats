import { describe, expect, it } from "vitest";
import { formatCurrency } from "../units";

/**
 * Not every currency has two decimals. A yen amount is whole, and a dinar has
 * three — a fixed cap of two silently drops the third digit, which is real
 * money in KWD, BHD, OMR, JOD, IQD, LYD and TND.
 */
describe("per-currency decimals", () => {
  it("formats each currency with its own number of decimals", () => {
    // 1234.56 JPY has no fractional part at all — asserting on "12,000" would
    // have matched the THOUSANDS separator instead of a decimal one.
    expect(formatCurrency(1234.56, "JPY")).not.toContain("56");
    expect(formatCurrency(1.234, "KWD")).toContain("234");
  });

  it("keeps two for the ordinary case", () => {
    expect(formatCurrency(12.34, "EUR")).toContain("34");
  });

  it("keeps a compact mode for the trip cards", () => {
    // The card shows a rounded headline figure; it had its own copy of the
    // formatter to get that, which is why a trip total and a stay total could
    // disagree about how a currency is written.
    expect(formatCurrency(1234.56, "EUR", { compact: true })).not.toContain(",56");
  });

  it("still renders something readable for a code Intl rejects", () => {
    expect(formatCurrency(10, "XYZ")).toContain("XYZ");
  });
});

import { describe, expect, it } from "vitest";
import { cruiseNights, cruiseStartMonth, listedPortCalls } from "../cruiseRowFacts";

/**
 * The truth table of `shared/cruiseRowFacts.ts`. The same table runs on the
 * other side of the mirror — the tab's fold and the evidence panel must read
 * one cruise the same way.
 */
describe("cruiseRowFacts", () => {
  it("counts nights between two days, from strings and dates alike", () => {
    expect(cruiseNights("2024-03-01", "2024-03-05")).toBe(4);
    expect(cruiseNights(new Date("2024-03-01T00:00:00Z"), new Date("2024-03-05T00:00:00Z"))).toBe(
      4
    );
    expect(cruiseNights("2024-03-01", "2024-03-01")).toBe(0);
  });

  it("abstains without both dates, or with an end before the start", () => {
    expect(cruiseNights(null, "2024-03-05")).toBeNull();
    expect(cruiseNights("2024-03-05", undefined)).toBeNull();
    expect(cruiseNights("2024-03-05", "2024-03-01")).toBeNull();
    expect(cruiseNights("not a date", "2024-03-01")).toBeNull();
  });

  it("reads the start month in UTC, and none without a start", () => {
    expect(cruiseStartMonth("2024-12-31")).toBe(11);
    expect(cruiseStartMonth(new Date("2025-01-01T00:00:00Z"))).toBe(0);
    expect(cruiseStartMonth(null)).toBeNull();
  });

  it("counts every listed stop that is not a sea day", () => {
    expect(listedPortCalls([{ isAtSea: false }, { isAtSea: true }, { isAtSea: false }])).toBe(2);
    expect(listedPortCalls(undefined)).toBe(0);
  });
});

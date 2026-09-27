import { describe, it, expect } from "vitest";
import { formatIsoDate } from "./dateUtils";

describe("formatIsoDate (E7: ISO dates in tables)", () => {
  it("passes a place's day through unchanged", () => {
    expect(formatIsoDate("2027-01-15")).toBe("2027-01-15");
  });

  it("reads an instant without a place on the UTC clock, whatever the reader's zone", () => {
    expect(formatIsoDate("2027-01-14T23:30:00Z")).toBe("2027-01-14");
    expect(formatIsoDate(new Date("2027-01-14T23:30:00Z"))).toBe("2027-01-14");
  });

  it("returns the dash for an unusable value", () => {
    expect(formatIsoDate("not-a-date")).toBe("—");
  });
});

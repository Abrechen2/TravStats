import { describe, it, expect } from "vitest";
import { formatMetricValue, formatMetricOrAbsent } from "../formatMetric";
import { recentYears } from "../years";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

describe("formatMetricValue", () => {
  it("prints distances in the reader's unit", () => {
    expect(formatMetricValue(1609.344, "km", { distanceUnit: "miles", t, language: "en" })).toBe(
      "1,000 stats:distance.miles"
    );
  });
  it("prints flight time as a duration and counts in the reader's language", () => {
    const ctx = { distanceUnit: "kilometers" as const, t, language: "de" };
    expect(formatMetricValue(125, "minutes", ctx)).toBe("2h 5min");
    expect(formatMetricValue(12345, "count", ctx)).toBe("12.345");
    expect(formatMetricValue(3, "nights", ctx)).toBe(
      'comparison:unit.nights:{"count":3,"value":"3"}'
    );
  });
  it("hands the plural rule a whole number, so 1.4 days is not 'days'", () => {
    const ctx = { distanceUnit: "kilometers" as const, t, language: "en" };
    expect(formatMetricValue(1.4, "days", ctx)).toBe(
      'comparison:unit.days:{"count":1,"value":"1"}'
    );
    expect(formatMetricValue(0.6, "nights", ctx)).toBe(
      'comparison:unit.nights:{"count":1,"value":"1"}'
    );
  });
});

describe("formatMetricOrAbsent", () => {
  const ctx = { distanceUnit: "kilometers" as const, t, language: "en" };
  it("prints a dash for an absent value instead of a zero", () => {
    expect(formatMetricOrAbsent(null, "count", ctx)).toBe("—");
    expect(formatMetricOrAbsent(undefined, "km", ctx)).toBe("—");
    expect(formatMetricOrAbsent(0, "count", ctx)).toBe("0");
  });
});

describe("recentYears", () => {
  it("counts back from this year", () => {
    expect(recentYears("UTC", new Date("2026-10-16T12:00:00Z"), 3)).toEqual([2026, 2025, 2024]);
  });
  it("asks the reader's zone, not the host's, for the year", () => {
    const newYearsEveUtc = new Date("2026-12-31T23:30:00Z");
    expect(recentYears("UTC", newYearsEveUtc, 1)).toEqual([2026]);
    expect(recentYears("Pacific/Auckland", newYearsEveUtc, 1)).toEqual([2027]);
  });
});

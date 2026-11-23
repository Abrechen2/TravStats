import { describe, it, expect } from "vitest";
import type { GapCalendar } from "../api/gapCalendar";
import { gapMonths, isDayString, unknownStretches } from "../gapCalendar";

const data = (runs: GapCalendar["runs"], year = 2028): GapCalendar => ({
  year,
  zone: "UTC",
  today: `${year}-12-31`,
  firstDay: `${year}-01-01`,
  years: [year],
  counts: {
    entry: 0,
    home: 0,
    place: 0,
    track: 0,
    privacyZone: 0,
    implausible: 0,
    unknown: 0,
    outside: 0,
  },
  runs,
});

describe("gap calendar helpers", () => {
  it("gives every month its own length, February of a leap year included", () => {
    const months = gapMonths(data([{ from: "2028-01-01", to: "2028-12-31", state: "track" }]));
    expect(months.map((m) => m.cells.length)).toEqual([
      31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });

  it("an inferred run keeps its flag on every day it covers, and a recorded day has none", () => {
    const months = gapMonths(
      data([
        { from: "2028-01-01", to: "2028-01-02", state: "home" },
        { from: "2028-01-03", to: "2028-01-04", state: "home", inferred: true },
      ])
    );
    expect(months[0].cells.slice(0, 4).map((c) => c.inferred ?? false)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("a day the server did not name is outside, never a gap", () => {
    const months = gapMonths(data([{ from: "2028-01-01", to: "2028-01-10", state: "unknown" }]));
    expect(months[0].cells[0].state).toBe("unknown");
    expect(months[0].cells[10].state).toBe("outside");
  });

  it("cuts an unknown stretch at the month's edges", () => {
    const d = data([{ from: "2028-01-20", to: "2028-02-05", state: "unknown" }]);
    expect(unknownStretches(d, "2028-01")).toEqual([
      { from: "2028-01-20", to: "2028-01-31", state: "unknown" },
    ]);
    expect(unknownStretches(d, "2028-02")).toEqual([
      { from: "2028-02-01", to: "2028-02-05", state: "unknown" },
    ]);
    expect(unknownStretches(d, "2028-03")).toEqual([]);
  });

  it("accepts only real days as a prefill", () => {
    expect(isDayString("2028-02-29")).toBe(true);
    expect(isDayString("2027-02-29")).toBe(false);
    expect(isDayString("2028-2-9")).toBe(false);
    expect(isDayString("<script>")).toBe(false);
  });
});

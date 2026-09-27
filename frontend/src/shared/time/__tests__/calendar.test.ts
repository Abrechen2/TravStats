import { describe, expect, it } from "vitest";
import {
  addDays,
  dayParts,
  dayString,
  daysBetween,
  daysInMonth,
  formatDayLong,
  weekdayOf,
} from "..";

/**
 * Calendar arithmetic on day strings — the same answers under UTC, UTC+14 and
 * UTC−3:30 (the odd-zone CI jobs run this file again with `TZ` set), and
 * straight across a DST change, where `setDate()` on a host-local Date slid.
 */
describe("calendar", () => {
  it("steps across month, year and DST boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29");
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
  });

  it("knows weekdays and month lengths", () => {
    expect(weekdayOf("2026-01-01")).toBe(4); // Thursday
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(dayString(2026, 13, 1)).toBe("2027-01-01");
    expect(dayParts("2026-08-01T01:00:00")).toEqual({ year: 2026, month: 8, day: 1 });
  });

  it("names a day in words without the reader's zone moving it", () => {
    expect(formatDayLong("2026-01-01", "de")).toBe("Donnerstag, 1. Januar 2026");
  });
});

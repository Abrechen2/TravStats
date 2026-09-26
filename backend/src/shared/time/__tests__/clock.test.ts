import { now, setClockForTests, todayIn } from "../clock";
import { todayIn as suggestionsTodayIn } from "../../../services/tripSuggestions/time";

/**
 * "Today" across midnight (ADR 0002 D6). An odd host zone does not catch a
 * bug that only shows up across midnight — the suite runs at whatever time
 * CI starts — so the clock is pinned one minute either side of midnight in
 * the zone that matters.
 */

afterEach(() => setClockForTests(null));

describe.each([
  // [zone, 23:59 local as UTC, 00:01 local as UTC, day before, day after]
  [
    "Pacific/Kiritimati",
    "2027-01-01T09:59:00Z",
    "2027-01-01T10:01:00Z",
    "2027-01-01",
    "2027-01-02",
  ],
  ["America/St_Johns", "2027-01-01T03:29:00Z", "2027-01-01T03:31:00Z", "2026-12-31", "2027-01-01"],
  ["Asia/Kathmandu", "2027-01-01T18:14:00Z", "2027-01-01T18:16:00Z", "2027-01-01", "2027-01-02"],
  ["Europe/Berlin", "2027-07-01T21:59:00Z", "2027-07-01T22:01:00Z", "2027-07-01", "2027-07-02"],
])("todayIn(%s) around local midnight", (zone, before, after, dayBefore, dayAfter) => {
  it("is still the old day at 23:59", () => {
    setClockForTests(before);
    expect(todayIn(zone)).toBe(dayBefore);
  });

  it("is the new day at 00:01", () => {
    setClockForTests(after);
    expect(todayIn(zone)).toBe(dayAfter);
  });

  it("reaches the trip-suggestion engine, which asks the clock instead of the host", () => {
    setClockForTests(after);
    expect(suggestionsTodayIn(zone)).toBe(dayAfter);
    setClockForTests(before);
    expect(suggestionsTodayIn(zone)).toBe(dayBefore);
  });
});

describe("the injected clock", () => {
  it("returns the pinned instant and restores the system clock", () => {
    setClockForTests("2027-03-28T01:30:00Z");
    expect(now().toISOString()).toBe("2027-03-28T01:30:00.000Z");
    setClockForTests(null);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("hands out a copy, so a caller mutating it cannot move time for the next", () => {
    setClockForTests("2027-03-28T01:30:00Z");
    now().setUTCFullYear(1999);
    expect(now().toISOString()).toBe("2027-03-28T01:30:00.000Z");
  });

  it("refuses to be pinned outside the test environment", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => setClockForTests("2027-01-01T00:00:00Z")).toThrow(/NODE_ENV=test/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

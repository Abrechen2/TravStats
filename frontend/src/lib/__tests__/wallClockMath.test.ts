import { describe, expect, it } from "vitest";
import { datetimeLocalOf, shiftWallClock } from "../wallClockMath";
import { flightDeparture } from "../entityTimes";

/**
 * Shifting a typed wall clock is arithmetic on the ticket's numbers. The odd-
 * zone CI jobs run this under UTC+14 and UTC−3:30 — and a browser in Berlin
 * on 28 March 2027 must not lose the hour its own clock skips.
 */
describe("shiftWallClock", () => {
  it("steps back 30 minutes across midnight", () => {
    expect(shiftWallClock("2027-01-01", "00:10", -30)).toEqual({
      date: "2026-12-31",
      time: "23:40",
    });
  });

  it("adds two hours onto the next day", () => {
    expect(shiftWallClock("2027-06-01", "23:15", 120)).toEqual({
      date: "2027-06-02",
      time: "01:15",
    });
  });

  it("ignores every zone's clock change — 01:45 + 30 min is 02:15, even on Berlin's spring-forward night", () => {
    expect(shiftWallClock("2027-03-28", "01:45", 30)).toEqual({
      date: "2027-03-28",
      time: "02:15",
    });
  });

  it("seeds an edit form from the airport's clock, not the browser's", () => {
    // 12:00Z is 21:00 at Haneda. A browser in Berlin read 14:00 here before.
    const departure = flightDeparture({
      departureTime: "2027-06-01T12:00:00.000Z",
      depTimezone: "Asia/Tokyo",
      depTimeSemantics: "UTC",
    });
    expect(datetimeLocalOf(departure)).toBe("2027-06-01T21:00");
    expect(datetimeLocalOf(null)).toBe("");
  });

  it("refuses input that is not a wall clock", () => {
    expect(shiftWallClock("", "10:00", 30)).toBeNull();
    expect(shiftWallClock("2027-06-01", "", 30)).toBeNull();
  });
});

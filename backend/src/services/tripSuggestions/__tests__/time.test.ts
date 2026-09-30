import { describe, expect, it } from "@jest/globals";

import { composeSuggestions } from "../compose";
import { addDays, daysBetween, placeClock, todayIn } from "../time";
import { AT, input, stay, visit } from "./fixtures";

/**
 * The engine's time rules (ADR 0002): the place's day for "which day", the
 * profile zone for "today", and no silent UTC for a zone nobody knows.
 */
describe("trip-suggestion time", () => {
  it("reads an instant on the place's calendar", () => {
    // 23:30 UTC on 2 May is already 3 May in Tokyo.
    const at = new Date("2025-05-02T23:30:00Z");
    expect(placeClock(at, "Asia/Tokyo", "UTC", 12)).toEqual({
      day: "2025-05-03",
      hour: 8,
      zoneKnown: true,
    });
  });

  it("flags an instant whose place has no zone instead of passing UTC off as local", () => {
    const at = new Date("2025-05-02T23:30:00Z");
    expect(placeClock(at, null, "UTC", 12)).toEqual({
      day: "2025-05-02",
      hour: 23,
      zoneKnown: false,
    });
  });

  it("needs no zone for a date-only or legacy wall-clock row", () => {
    const at = new Date("2025-05-02T00:00:00Z");
    expect(placeClock(at, null, "DATE_ONLY", 12).zoneKnown).toBe(true);
    expect(placeClock(at, null, "LEGACY_FAKE_UTC", 12).zoneKnown).toBe(true);
  });

  it("takes today from the profile zone", () => {
    const lateEvening = new Date("2025-05-02T23:30:00Z");
    expect(todayIn("Europe/Berlin", lateEvening)).toBe("2025-05-03");
    expect(todayIn("America/New_York", lateEvening)).toBe("2025-05-02");
  });

  it("counts days on keys, across a DST change", () => {
    expect(addDays("2025-03-29", 2)).toBe("2025-03-31");
    expect(daysBetween("2025-10-25", "2025-10-28")).toEqual([
      "2025-10-25",
      "2025-10-26",
      "2025-10-27",
    ]);
  });

  it("says how many entries of a proposal had no zone", () => {
    const entries = [
      stay("a", AT.FIRENZE, "2025-05-03", "2025-05-06", "Florenz", { zoneUnknown: true }),
      visit("b", AT.FIRENZE, "2025-05-04"),
    ];
    expect(composeSuggestions(input({ entries }))[0].zoneUnknown).toBe(1);
  });
});

/**
 * forgejo#273 — mirror of `backend/src/__tests__/localWallClock.test.ts`'s
 * date-only cases; change both together. A DATE_ONLY row stores 12:00Z of the
 * recorded day, and that day is the answer: read through a zone at UTC+12 or
 * beyond the placeholder is the next local day, and the overview tab filed
 * such a flight under the next day, month or year.
 */
import { describe, expect, it } from "vitest";
import { localWallClockOf } from "../localWallClock";

describe("localWallClockOf — a date-only row is its recorded calendar day", () => {
  it.each([
    ["Pacific/Auckland", "2020-06-30T12:00:00Z", "2020-06-30"],
    ["Pacific/Auckland", "2025-12-31T12:00:00Z", "2025-12-31"],
    ["Pacific/Fiji", "2026-03-31T12:00:00Z", "2026-03-31"],
    ["Pacific/Kiritimati", "2026-09-01T12:00:00Z", "2026-09-01"],
    ["Pacific/Honolulu", "2026-09-01T12:00:00Z", "2026-09-01"],
  ])("%s %s stays on %s", (zone, stored, day) => {
    const clock = localWallClockOf(new Date(stored), zone, "DATE_ONLY");
    expect(clock.date).toBe(day);
    expect(clock.hour).toBeNull();
  });

  it("derives year, month and weekday from the recorded day", () => {
    expect(
      localWallClockOf(new Date("2025-12-31T12:00:00Z"), "Pacific/Auckland", "DATE_ONLY")
    ).toEqual({ date: "2025-12-31", year: 2025, month: 11, weekday: 3, hour: null });
  });

  it("still reads a timed row in the same zone on the local clock", () => {
    const clock = localWallClockOf(new Date("2025-12-31T12:00:00Z"), "Pacific/Auckland", "UTC");
    expect(clock.date).toBe("2026-01-01");
    expect(clock.hour).toBe(1);
  });
});

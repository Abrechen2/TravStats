import { describe, it, expect } from "vitest";

import { localWallClockOf } from "../localWallClock";

/**
 * The backend's year-/month-only placeholder cases
 * (`backend/src/__tests__/localWallClock.test.ts`), mirrored: this side read a
 * legacy placeholder (midnight UTC on the 1st) through a western zone and
 * filed 1 January 2015 under 2014 in the browser's overview, while the server
 * filed it under 2015 (forgejo#256).
 */
describe("localWallClockOf — year-/month-only placeholders", () => {
  it("keeps a year-only placeholder in the year it names, west of UTC", () => {
    const clock = localWallClockOf(new Date("2015-01-01T00:00:00Z"), "America/New_York", "UNKNOWN");
    expect(clock.year).toBe(2015);
    expect(clock.month).toBe(0);
    expect(clock.date).toBe("2015-01-01");
  });

  it("keeps a month-only placeholder in its month, west of UTC", () => {
    const clock = localWallClockOf(
      new Date("2015-03-01T00:00:00Z"),
      "America/Los_Angeles",
      "UNKNOWN"
    );
    expect(clock.date).toBe("2015-03-01");
  });

  it("still reads an unclassified real time on the airport's clock", () => {
    const clock = localWallClockOf(new Date("2026-01-01T03:30:00Z"), "America/New_York", "UNKNOWN");
    expect(clock.date).toBe("2025-12-31");
  });

  it("never reads a real 00:00 UTC departure as a placeholder", () => {
    const clock = localWallClockOf(new Date("2015-03-01T00:00:00Z"), "America/New_York", "UTC");
    expect(clock.date).toBe("2015-02-28");
    expect(clock.hour).toBe(19);
  });

  it("trusts a stored minute precision over the placeholder shape", () => {
    const clock = localWallClockOf(
      new Date("2015-03-01T00:00:00Z"),
      "America/New_York",
      "UNKNOWN",
      "minute"
    );
    expect(clock.date).toBe("2015-02-28");
  });

  it("reads a marked year-only entry written through its zone on its own day, with no hour", () => {
    const clock = localWallClockOf(
      new Date("2015-01-01T05:00:00Z"),
      "America/New_York",
      "UNKNOWN",
      "year"
    );
    expect(clock.date).toBe("2015-01-01");
    expect(clock.hour).toBeNull();
  });
});

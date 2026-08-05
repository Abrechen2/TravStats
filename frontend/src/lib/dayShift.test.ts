import { describe, it, expect } from "vitest";
import { dayShift } from "./dayShift";

describe("dayShift", () => {
  it("is 0 for a same-day flight", () => {
    expect(dayShift("2026-08-15T08:20:00Z", "2026-08-15T10:05:00Z", "Europe/Berlin", "Europe/Copenhagen")).toBe(0);
  });

  it("is 1 for an overnight eastbound flight", () => {
    // dep 21:40 Berlin (19:40Z), arr 06:45 Dubai next local day (02:45Z next day)
    expect(dayShift("2026-05-02T19:40:00Z", "2026-05-03T02:45:00Z", "Europe/Berlin", "Asia/Dubai")).toBe(1);
  });

  it("can be negative for westbound across midnight the other way", () => {
    // dep 01:00 Tokyo local on the 2nd (16:00Z on the 1st), arr 17:00 LA local on the 1st
    expect(dayShift("2026-05-01T16:00:00Z", "2026-05-02T00:00:00Z", "Asia/Tokyo", "America/Los_Angeles")).toBe(-1);
  });

  it("falls back to UTC when tz missing", () => {
    expect(dayShift("2026-05-02T23:00:00Z", "2026-05-03T01:00:00Z", null, null)).toBe(1);
  });
});

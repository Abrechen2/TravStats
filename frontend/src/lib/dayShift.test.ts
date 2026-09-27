import { describe, it, expect } from "vitest";
import { dayShift } from "./dayShift";
import { timeValueAtZone, type TimeValue } from "../shared/time";

const at = (utc: string, zone: string | null): TimeValue => timeValueAtZone(utc, zone)!;

describe("dayShift — on each airport's own calendar", () => {
  it("is 0 for a same-day flight", () => {
    expect(
      dayShift(
        at("2026-08-15T08:20:00Z", "Europe/Berlin"),
        at("2026-08-15T10:05:00Z", "Europe/Copenhagen")
      )
    ).toBe(0);
  });

  it("is 1 for an overnight eastbound flight", () => {
    // dep 21:40 Berlin (19:40Z), arr 06:45 Dubai next local day (02:45Z next day)
    expect(
      dayShift(
        at("2026-05-02T19:40:00Z", "Europe/Berlin"),
        at("2026-05-03T02:45:00Z", "Asia/Dubai")
      )
    ).toBe(1);
  });

  it("can be negative for westbound across midnight the other way", () => {
    // dep 01:00 Tokyo local on the 2nd (16:00Z on the 1st), arr 17:00 LA local on the 1st
    expect(
      dayShift(
        at("2026-05-01T16:00:00Z", "Asia/Tokyo"),
        at("2026-05-02T00:00:00Z", "America/Los_Angeles")
      )
    ).toBe(-1);
  });

  it("counts UTC days for ends without a known zone, as they are shown", () => {
    expect(dayShift(at("2026-05-02T23:00:00Z", null), at("2026-05-03T01:00:00Z", null))).toBe(1);
  });

  it("reads the server's `local`, not the instant", () => {
    const dep: TimeValue = {
      utc: "2026-05-01T16:00:00.000Z",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      local: "2026-05-02T01:00:00",
      precision: "minute",
    };
    const arr = { ...dep, utc: "2026-05-02T00:00:00.000Z", local: "2026-05-01T17:00:00" };
    expect(dayShift(dep, arr)).toBe(-1);
  });
});

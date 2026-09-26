/**
 * The web time module under three host zones (ADR 0002, D6).
 *
 * Each block runs with the process's own zone switched — UTC, UTC+14
 * (Pacific/Kiritimati) and UTC−3:30 (America/St_Johns). Node re-reads `TZ`
 * when it is assigned, and the first test of each block proves that the
 * switch took (a host-local getter moves), so a green run here cannot be a
 * run that silently stayed in UTC. Every answer below must be the same in all
 * three: this module must not depend on the machine it runs on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ZoneUnknownError,
  formatOffset,
  formatTimeValue,
  isValidZone,
  localDay,
  now,
  setClockForTests,
  toLocal,
  todayIn,
  type TimeValue,
} from "..";
import { formatWallClockIn } from "../../zonedWallClock";
import { localWallClockOf } from "../../localWallClock";

/** Host offsets (Date#getTimezoneOffset, minutes WEST of UTC) on 2027-01-01. */
const HOST_ZONES: Array<[string, number]> = [
  ["UTC", 0],
  ["Pacific/Kiritimati", -840],
  ["America/St_Johns", 210],
];

const originalTz = process.env.TZ;

describe.each(HOST_ZONES)("shared/time with the host in %s", (hostZone, hostOffset) => {
  beforeAll(() => {
    process.env.TZ = hostZone;
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  afterEach(() => setClockForTests(null));

  it("really runs in that host zone (control)", () => {
    expect(new Date(Date.UTC(2027, 0, 1)).getTimezoneOffset()).toBe(hostOffset);
  });

  it("reads an instant in the place's zone, whatever the host", () => {
    expect(toLocal("2027-01-14T18:45:00Z", "Asia/Kolkata")).toEqual({
      local: "2027-01-15T00:15",
      offset: "+05:30",
    });
    expect(toLocal("2027-01-14T23:59:00Z", "Asia/Kathmandu")).toEqual({
      local: "2027-01-15T05:44",
      offset: "+05:45",
    });
    expect(toLocal(new Date("2027-06-01T01:00:00Z"), "Asia/Tokyo").local).toBe("2027-06-01T10:00");
  });

  it("reads a moment inside a DST gap as the post-gap clock (machine source)", () => {
    expect(toLocal("2027-03-28T01:30:00Z", "Europe/Berlin")).toEqual({
      local: "2027-03-28T03:30",
      offset: "+02:00",
    });
  });

  it("reads both sides of the repeated hour with their own offsets", () => {
    expect(toLocal("2027-10-31T00:30:00Z", "Europe/Berlin")).toEqual({
      local: "2027-10-31T02:30",
      offset: "+02:00",
    });
    expect(toLocal("2027-10-31T01:30:00Z", "Europe/Berlin")).toEqual({
      local: "2027-10-31T02:30",
      offset: "+01:00",
    });
  });

  it("follows historical zone changes (Samoa 2011, Moscow, Istanbul)", () => {
    expect(toLocal("2011-12-30T09:00:00Z", "Pacific/Apia")).toEqual({
      local: "2011-12-29T23:00",
      offset: "-10:00",
    });
    expect(toLocal("2011-12-30T10:00:00Z", "Pacific/Apia")).toEqual({
      local: "2011-12-31T00:00",
      offset: "+14:00",
    });
    expect(toLocal("2012-07-01T12:00:00Z", "Europe/Moscow").offset).toBe("+04:00");
    expect(toLocal("2015-07-01T12:00:00Z", "Europe/Moscow").offset).toBe("+03:00");
    expect(toLocal("2016-11-15T12:00:00Z", "Europe/Istanbul")).toEqual({
      local: "2016-11-15T15:00",
      offset: "+03:00",
    });
    expect(toLocal("2015-11-15T12:00:00Z", "Europe/Istanbul").offset).toBe("+02:00");
  });

  it("answers the calendar day in the place's zone", () => {
    // A red-eye out of New York on New Year's Eve belongs to 2026 there.
    expect(localDay("2027-01-01T03:30:00Z", "America/New_York")).toBe("2026-12-31");
    expect(localDay("2027-07-10T20:40:00Z", "Europe/Paris")).toBe("2027-07-10");
    expect(localDay("2027-07-11T06:10:00Z", "Europe/Paris")).toBe("2027-07-11");
  });

  // Kiritimati's midnight is 10:00Z (UTC+14). The plan's table says
  // 10:59Z/11:00Z, which straddles 00:59/01:00 local — no day boundary.
  it.each([
    ["2027-01-01T09:59:00Z", "Pacific/Kiritimati", "2027-01-01"],
    ["2027-01-01T10:01:00Z", "Pacific/Kiritimati", "2027-01-02"],
    ["2027-01-01T03:29:00Z", "America/St_Johns", "2026-12-31"],
    ["2027-01-01T03:31:00Z", "America/St_Johns", "2027-01-01"],
    ["2027-01-01T22:59:00Z", "Europe/Berlin", "2027-01-01"],
    ["2027-01-01T23:01:00Z", "Europe/Berlin", "2027-01-02"],
  ])("today at %s in %s is %s — from the pinned clock", (at, zone, day) => {
    setClockForTests(at);
    expect(now().toISOString()).toBe(new Date(at).toISOString());
    expect(todayIn(zone)).toBe(day);
  });

  it("refuses a zone it does not know instead of inventing a clock", () => {
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("Europe/Berlin")).toBe(true);
    expect(() => toLocal("2027-01-01T00:00:00Z", "Mars/Olympus")).toThrow(ZoneUnknownError);
    expect(() => localDay("2027-01-01T00:00:00Z", "Mars/Olympus")).toThrow(
      expect.objectContaining({ code: "ZONE_UNKNOWN" })
    );
    expect(() => toLocal("not a date", "UTC")).toThrow(RangeError);
  });

  it("displays a server TimeValue from its own local fields, even for an unknown zone", () => {
    const value: TimeValue = {
      utc: "2027-03-28T01:30:00Z",
      zone: "Mars/Olympus",
      offset: "+02:00",
      local: "2027-03-28T03:30",
      precision: "minute",
    };
    const shown = formatTimeValue(value, "en-GB");
    expect(shown).toContain("28 Mar 2027");
    expect(shown).toContain("03:30");
  });

  it("cuts the display to the value's precision", () => {
    const base: TimeValue = {
      utc: "2027-05-01T20:00:00Z",
      zone: "Pacific/Kiritimati",
      offset: "+14:00",
      local: "2027-05-02T10:00",
      precision: "day",
    };
    expect(formatTimeValue(base, "en-GB")).toBe("2 May 2027");
    expect(formatTimeValue({ ...base, precision: "unknown" }, "en-GB")).toBe("2 May 2027");
    expect(formatTimeValue({ ...base, precision: "month" }, "de-DE")).toBe("Mai 2027");
    expect(formatTimeValue({ ...base, precision: "year" }, "de-DE")).toBe("2027");
    expect(formatTimeValue({ ...base, local: "garbled" }, "de-DE")).toBe("garbled");
  });

  it("formats offsets, including historical second offsets", () => {
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(-12600)).toBe("-03:30");
    expect(formatOffset(20700)).toBe("+05:45");
    expect(formatOffset(3208)).toBe("+00:53:28");
  });

  it("the older helpers now read through shared/time and agree with it", () => {
    expect(formatWallClockIn(new Date("2025-03-30T02:30:00Z"), "UTC")).toBe("2025-03-30T02:30:00");
    expect(formatWallClockIn(new Date("2027-01-01T00:00:00Z"), "Nowhere/Zone")).toBeNull();
    expect(localWallClockOf(new Date("2027-01-01T03:30:00Z"), "America/New_York", "UTC")).toEqual({
      date: "2026-12-31",
      year: 2026,
      month: 11,
      weekday: 4,
      hour: 22,
    });
  });
});

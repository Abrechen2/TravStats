import { describe, expect, it } from "vitest";
import {
  clockOf,
  dayOf,
  localDateFromDayColumn,
  readsAsUtc,
  timeValueAtZone,
  timeValueFromWallClock,
  viewerReading,
  type TimeValue,
} from "..";

/**
 * The web's readers of a time (ADR 0002 phase 4). Every expectation here is
 * independent of the process zone — the odd-zone CI jobs run this file under
 * Kiritimati and St John's, where a host-local getter would move the day.
 */
const hnd: TimeValue = {
  utc: "2026-07-31T16:00:00.000Z",
  zone: "Asia/Tokyo",
  offset: "+09:00",
  local: "2026-08-01T01:00:00",
  precision: "minute",
};

describe("dayOf / clockOf", () => {
  it("take the day and clock from `local`, not from `utc`", () => {
    expect(dayOf(hnd)).toBe("2026-08-01");
    expect(clockOf(hnd)).toBe("01:00");
  });

  it("give no clock for a value that does not know its time of day", () => {
    expect(clockOf({ ...hnd, precision: "day" })).toBeNull();
    expect(clockOf({ ...hnd, precision: "unknown" })).toBeNull();
  });
});

describe("viewerReading — the optional 'your time' hint (Q2)", () => {
  it("reads the same instant on the viewer's clock", () => {
    expect(viewerReading(hnd, "Europe/Berlin")).toEqual({
      local: "2026-07-31T18:00:00",
      offset: "+02:00",
    });
  });

  it("says nothing for a viewer already on the place's clock", () => {
    expect(viewerReading(hnd, "Asia/Tokyo")).toBeNull();
  });

  it("says nothing for a day-only value or an unknown viewer zone", () => {
    expect(viewerReading({ ...hnd, precision: "day" }, "Europe/Berlin")).toBeNull();
    expect(viewerReading(hnd, "Mars/Olympus")).toBeNull();
    expect(viewerReading(hnd, null)).toBeNull();
  });
});

describe("legacy readers — payloads without `times`", () => {
  it("read a real instant on its place's clock", () => {
    expect(timeValueAtZone("2026-07-31T16:00:00.000Z", "Asia/Tokyo")).toEqual(hnd);
  });

  it("read an instant without a known zone on the UTC clock, and say so", () => {
    const value = timeValueAtZone("2026-07-31T16:00:00.000Z", null);
    expect(value?.local).toBe("2026-07-31T16:00:00");
    expect(value && readsAsUtc(value)).toBe(true);
    // A zone the runtime does not know is no zone — never a guess.
    expect(timeValueAtZone("2026-07-31T16:00:00.000Z", "Mars/Olympus")?.zone).toBeNull();
  });

  it("show a fake-UTC wall clock as it was typed, not as a UTC reading", () => {
    const value = timeValueFromWallClock("2026-05-01T14:30:00.000Z");
    expect(value?.local).toBe("2026-05-01T14:30:00");
    expect(value?.precision).toBe("minute");
    expect(value && readsAsUtc(value)).toBe(false);
    // Midnight exactly was the "no time given" convention.
    expect(timeValueFromWallClock("2026-05-01T00:00:00.000Z")?.precision).toBe("day");
  });

  it("read a day column as its UTC date, whatever the reader's zone", () => {
    expect(localDateFromDayColumn("2026-05-02T00:00:00.000Z")).toEqual({
      date: "2026-05-02",
      zone: null,
      precision: "day",
    });
    expect(localDateFromDayColumn("2026-05-02")?.date).toBe("2026-05-02");
    expect(localDateFromDayColumn(null)).toBeNull();
    expect(timeValueAtZone("nonsense", "Asia/Tokyo")).toBeNull();
  });
});

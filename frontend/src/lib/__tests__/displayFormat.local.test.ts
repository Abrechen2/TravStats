import { describe, expect, it } from "vitest";
import { formatLocalClockWith, formatLocalDateWith, formatTimeValueWith } from "../displayFormat";
import { yourTimeText } from "../yourTime";
import type { TimeValue } from "../../shared/time";

/**
 * A place's time in the user's format (Settings → Display), from `local` —
 * no zone is consulted, so the reader's own zone cannot move a day or a clock
 * (ADR 0002, D3). The odd-zone CI jobs run this under UTC+14 and UTC−3:30.
 */
const de = { dateFormat: "DD.MM.YYYY", timeFormat: "24h" } as const;
const us = { dateFormat: "MM/DD/YYYY", timeFormat: "12h" } as const;

const kiritimatiEvening: TimeValue = {
  utc: "2026-12-31T09:30:00.000Z",
  zone: "Pacific/Kiritimati",
  offset: "+14:00",
  local: "2026-12-31T23:30:00",
  precision: "minute",
};

describe("local formatting", () => {
  it("prints the place's day and clock in the chosen format", () => {
    expect(formatTimeValueWith(de, kiritimatiEvening)).toBe("31.12.2026 23:30");
    expect(formatTimeValueWith(us, kiritimatiEvening)).toBe("12/31/2026 11:30 PM");
  });

  it("cuts to the value's precision", () => {
    expect(formatTimeValueWith(de, { ...kiritimatiEvening, precision: "day" })).toBe("31.12.2026");
    expect(formatTimeValueWith(de, { ...kiritimatiEvening, precision: "year" })).toBe("2026");
    expect(formatTimeValueWith(de, kiritimatiEvening, { dateOnly: true })).toBe("31.12.2026");
  });

  it("formats a bare day and a bare clock", () => {
    expect(formatLocalDateWith(de, "2027-01-01")).toBe("01.01.2027");
    expect(formatLocalDateWith(de, "2027-01-01", { weekday: true, language: "de" })).toBe(
      "Fr 01.01.2027"
    );
    expect(formatLocalClockWith(us, "00:05")).toBe("12:05 AM");
    expect(formatLocalDateWith(de, "not a day")).toBe("");
  });
});

describe("yourTimeText — the optional hint beside a place's time (Q2)", () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}|${String(options?.time)}`;

  it("names the viewer's clock, and the day when it differs", () => {
    expect(yourTimeText(kiritimatiEvening, "Europe/Berlin", t)).toBe("common:time.yourTime|10:30");
    expect(yourTimeText(kiritimatiEvening, "Pacific/Honolulu", t)).toBe(
      "common:time.yourTime|30.12. 23:30"
    );
  });

  it("is absent when the viewer is on the place's clock", () => {
    expect(yourTimeText(kiritimatiEvening, "Pacific/Kiritimati", t)).toBeNull();
  });
});

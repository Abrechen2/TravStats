import { describe, it, expect } from "vitest";

import { formatDateTimeWith, formatDateWith, formatTimeWith } from "../displayFormat";

/**
 * The user's date and time format, as a truth table. Before this module the
 * setting was stored and read by nothing (tester report, 2026-09-17), so each
 * case here is a promise the Settings page makes.
 */
const AT = "2026-10-02T12:05:00Z";

describe("displayFormat", () => {
  it.each([
    ["DD.MM.YYYY", "02.10.2026"],
    ["MM/DD/YYYY", "10/02/2026"],
    ["YYYY-MM-DD", "2026-10-02"],
  ] as const)("writes a date as %s", (dateFormat, expected) => {
    expect(formatDateWith({ dateFormat, timeFormat: "24h" }, AT, { timeZone: "UTC" })).toBe(
      expected
    );
  });

  it("follows the 24h or 12h clock", () => {
    const base = { dateFormat: "DD.MM.YYYY" } as const;
    expect(formatTimeWith({ ...base, timeFormat: "24h" }, AT, { timeZone: "UTC" })).toBe("12:05");
    expect(formatTimeWith({ ...base, timeFormat: "12h" }, AT, { timeZone: "UTC" })).toBe(
      "12:05 PM"
    );
    expect(
      formatTimeWith({ ...base, timeFormat: "12h" }, "2026-10-02T14:05:00Z", { timeZone: "UTC" })
    ).toBe("2:05 PM");
  });

  it("shows the calendar day and clock of the zone asked for, not the viewer's", () => {
    const prefs = { dateFormat: "YYYY-MM-DD", timeFormat: "24h" } as const;
    // 23:30 UTC is already the next day in Tokyo.
    expect(formatDateTimeWith(prefs, "2026-10-02T23:30:00Z", { timeZone: "Asia/Tokyo" })).toBe(
      "2026-10-03 08:30"
    );
  });

  it("adds a weekday in the UI language and shortens the year for dense tables", () => {
    const prefs = { dateFormat: "DD.MM.YYYY", timeFormat: "24h" } as const;
    expect(
      formatDateWith(prefs, AT, { timeZone: "UTC", weekday: true, shortYear: true, language: "de" })
    ).toBe("Fr 02.10.26");
    expect(formatDateWith(prefs, AT, { timeZone: "UTC", weekday: true, language: "en" })).toBe(
      "Fri 02.10.2026"
    );
  });

  it("keeps a four-digit year in ISO order even where a table asks for a short one", () => {
    const prefs = { dateFormat: "YYYY-MM-DD", timeFormat: "24h" } as const;
    expect(formatDateWith(prefs, AT, { timeZone: "UTC", shortYear: true })).toBe("2026-10-02");
  });

  it("drops the year in the chosen order when a compact place asks for it", () => {
    const at = { timeZone: "UTC", omitYear: true };
    expect(formatDateWith({ dateFormat: "DD.MM.YYYY", timeFormat: "24h" }, AT, at)).toBe("02.10.");
    expect(formatDateWith({ dateFormat: "MM/DD/YYYY", timeFormat: "24h" }, AT, at)).toBe("10/02");
    expect(formatDateWith({ dateFormat: "YYYY-MM-DD", timeFormat: "24h" }, AT, at)).toBe("10-02");
  });

  it("answers empty for a value that is not a date, rather than 'Invalid Date'", () => {
    const prefs = { dateFormat: "DD.MM.YYYY", timeFormat: "24h" } as const;
    expect(formatDateWith(prefs, "not a date")).toBe("");
    expect(formatDateTimeWith(prefs, "")).toBe("");
  });
});

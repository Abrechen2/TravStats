import { describe, it, expect } from "@jest/globals";
import {
  escapeHtml,
  formatDurationMinutes,
  formatHoursUntil,
  formatLocalDate,
  formatTimeValue,
} from "../reminderFormat";
import type { TimeValue } from "../../../shared/time/wire";

function tv(local: string, zone: string | null): TimeValue {
  return {
    utc: "2026-09-27T00:00:00.000Z",
    zone,
    offset: "+00:00",
    local,
    precision: "minute",
    zoneSource: zone ? "stored" : null,
  };
}

describe("formatTimeValue", () => {
  it("formats DE as weekday, dd.mm.yyyy, HH:mm Uhr", () => {
    expect(formatTimeValue(tv("2026-09-27T14:30:00", "Europe/Berlin"), "de")).toBe(
      "So., 27.09.2026, 14:30 Uhr"
    );
  });

  it("formats EN as weekday, Mon d, yyyy, h:mm AM/PM", () => {
    expect(formatTimeValue(tv("2026-09-27T14:30:00", "Europe/Berlin"), "en")).toBe(
      "Sun, Sep 27, 2026, 2:30 PM"
    );
  });

  // A day-precision value is stored at the start of its day. Printing its
  // clock would announce a "00:00" nobody booked.
  it("prints a DAY-precision value as its date alone, and nothing for a coarser one", () => {
    const day = { ...tv("2026-09-27T00:00:00", "Europe/Berlin"), precision: "day" as const };
    expect(formatTimeValue(day, "de")).toBe("So., 27.09.2026");
    expect(formatTimeValue(day, "en")).toBe("Sun, Sep 27, 2026");
    for (const precision of ["month", "year", "unknown"] as const) {
      expect(formatTimeValue({ ...day, precision }, "de")).toBeNull();
    }
  });

  it("formats midnight and noon correctly in EN 12h", () => {
    expect(formatTimeValue(tv("2026-01-01T00:05:00", "UTC"), "en")).toContain("12:05 AM");
    expect(formatTimeValue(tv("2026-01-01T12:00:00", "UTC"), "en")).toContain("12:00 PM");
  });

  it("labels a zoneless value as UTC rather than passing it off as local", () => {
    const value = tv("2026-09-27T14:30:00", null);
    expect(formatTimeValue(value, "de")).toBe("So., 27.09.2026, 14:30 Uhr (UTC)");
    expect(formatTimeValue(value, "en")).toBe("Sun, Sep 27, 2026, 2:30 PM (UTC)");
  });

  // The weekday belongs to the DATE, not to the host. 2024-02-29 was a
  // Thursday and 2026-01-01 is one too; under TZ=Pacific/Kiritimati a
  // host-zone getter would answer Friday for both.
  it("names the weekday of the calendar date, independent of the host's zone", () => {
    expect(formatLocalDate("2024-02-29", "de")).toBe("Do., 29.02.2024");
    expect(formatLocalDate("2026-01-01", "en")).toBe("Thu, Jan 1, 2026");
    expect(formatLocalDate("2026-12-31", "de")).toBe("Do., 31.12.2026");
  });

  it("returns null for anything that is not a full calendar date", () => {
    for (const value of [null, undefined, "", "2026-09", "2026", "27.09.2026", "null"]) {
      expect(formatLocalDate(value, "de")).toBeNull();
    }
  });

  it("returns null for a null/undefined TimeValue", () => {
    expect(formatTimeValue(null, "de")).toBeNull();
    expect(formatTimeValue(undefined, "en")).toBeNull();
  });

  // POSITIVE CONTROL for the local-time-display fix: a non-UTC zone whose
  // wall clock genuinely differs from the raw UTC reading. The OLD reminder
  // email built its departure string from `departureTime.toISOString()`
  // directly (raw UTC, always) — this value's `local` field is what
  // `shared/time`'s TimeValue carries for the AIRPORT's clock, and it must
  // show the airport's hour (09:15), never the UTC hour the old code showed.
  it("shows the PLACE's local hour, not the raw UTC hour, for a non-UTC zone", () => {
    // New York, UTC-4 in September (EDT): 13:15 UTC == 09:15 local.
    const value: TimeValue = {
      utc: "2026-09-27T13:15:00.000Z",
      zone: "America/New_York",
      offset: "-04:00",
      local: "2026-09-27T09:15:00",
      precision: "minute",
      zoneSource: "stored",
    };
    const formatted = formatTimeValue(value, "de");
    expect(formatted).toContain("09:15");
    expect(formatted).not.toContain("13:15");
  });
});

describe("formatHoursUntil", () => {
  it("phrases 24h and 2h naturally in DE and EN", () => {
    expect(formatHoursUntil(24, "de")).toBe("in 24 Stunden");
    expect(formatHoursUntil(2, "de")).toBe("in 2 Stunden");
    expect(formatHoursUntil(24, "en")).toBe("in 24 hours");
    expect(formatHoursUntil(1, "en")).toBe("in 1 hour");
  });
});

describe("formatDurationMinutes", () => {
  it("splits hours and minutes in DE and EN", () => {
    expect(formatDurationMinutes(135, "de")).toBe("2 Std. 15 Min.");
    expect(formatDurationMinutes(135, "en")).toBe("2h 15m");
    expect(formatDurationMinutes(45, "de")).toBe("45 Min.");
    expect(formatDurationMinutes(45, "en")).toBe("45m");
  });

  it("abstains (null) rather than showing 0 for an unmeasured duration", () => {
    expect(formatDurationMinutes(null, "de")).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;"
    );
  });
});

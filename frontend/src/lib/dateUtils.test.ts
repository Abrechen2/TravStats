import { describe, it, expect } from "vitest";
import { formatDateInTimezone, formatDateTimeInTimezone, formatTimeInTimezone } from "./dateUtils";

describe("dateUtils", () => {
  const date = new Date("2026-05-01T10:00:00Z"); // 10:00 UTC

  it("formats date in UTC timezone", () => {
    const result = formatDateInTimezone(date, "UTC");
    expect(result).toBe("01.05.2026");
  });

  it("formats date in Berlin timezone (UTC+2 in summer)", () => {
    const result = formatDateInTimezone(date, "Europe/Berlin");
    expect(result).toBe("01.05.2026");
  });

  it("formats datetime with time component", () => {
    const result = formatDateTimeInTimezone(date, "UTC");
    expect(result).toContain("10:00");
  });

  it("handles string date input", () => {
    const result = formatDateInTimezone("2026-05-01T10:00:00Z", "UTC");
    expect(result).toBe("01.05.2026");
  });

  it("returns fallback for invalid date", () => {
    const result = formatDateInTimezone("not-a-date", "UTC");
    expect(result).toBe("—");
  });

  it("falls back to UTC for invalid timezone", () => {
    const result = formatDateInTimezone(date, "Invalid/Timezone");
    // Should not throw — returns a valid date string
    expect(result).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  it("formats time-only with formatTimeInTimezone", () => {
    const result = formatTimeInTimezone(date, "UTC");
    expect(result).toContain("10:00");
  });
});

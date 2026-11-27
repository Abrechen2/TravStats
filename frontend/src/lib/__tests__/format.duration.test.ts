import { describe, it, expect } from "vitest";
import { formatDuration, formatKm, formatMetres, formatMoney } from "../format";

describe("formatDuration", () => {
  it("shows only minutes when under 60", () => {
    expect(formatDuration(45)).toBe("45\u00A0min");
  });
  it("shows only hours when no remainder", () => {
    expect(formatDuration(120)).toBe("2\u00A0h");
  });
  it("shows hours and minutes", () => {
    expect(formatDuration(155)).toBe("2\u00A0h\u00A035\u00A0min");
  });
  it("pads the minutes after hours, as the design writes them", () => {
    expect(formatDuration(125)).toBe("2\u00A0h\u00A005\u00A0min");
  });
  it("handles 0", () => {
    expect(formatDuration(0)).toBe("0\u00A0min");
  });
});

describe("formatDuration days", () => {
  it("reads 48 hours or more as days and hours when asked", () => {
    expect(formatDuration(76 * 60, { days: true, language: "en" })).toBe("3\u00A0d\u00A04\u00A0h");
    expect(formatDuration(76 * 60, { days: true, language: "de" })).toBe("3\u00A0T\u00A04\u00A0h");
    expect(formatDuration(18 * 60 + 40, { days: true })).toBe("18\u00A0h\u00A040\u00A0min");
    expect(formatDuration(76 * 60)).toBe("76\u00A0h");
  });
});

describe("formatKm / formatMetres / formatMoney", () => {
  it("abstains with a dash on an unknown distance, never 0", () => {
    expect(formatKm(null)).toBe("—");
  });
  it("converts km to the chosen unit and groups in the chosen language", () => {
    expect(formatKm(3931, { unit: "kilometers", language: "de" })).toBe("3.931 km");
    expect(formatKm(100, { unit: "miles", language: "en" })).toBe("62 mi");
  });
  it("shows a sub-kilometre gap in metres and a longer one with one decimal", () => {
    expect(formatMetres(350, { unit: "kilometers", language: "en" })).toBe("350 m");
    expect(formatMetres(1450, { unit: "kilometers", language: "en" })).toBe("1.5 km");
  });
  it("writes an unknown amount as a dash and a currency-less one as a bare number", () => {
    expect(formatMoney(null, "EUR")).toBe("—");
    expect(formatMoney(1200, null, { language: "en" })).toBe("1,200");
  });
});

describe("formatDuration abstains", () => {
  it("reads a non-finite duration as a dash, not NaNhNaNmin", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatDuration never breaks across lines", () => {
  it("joins number and unit with a no-break space (the flight-time column wrapped '2 h 07 / min')", () => {
    expect(formatDuration(127)).toBe("2 h 07 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(60 * 51, { days: true, language: "en" })).toBe("2 d 3 h");
  });
});

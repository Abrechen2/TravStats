import { describe, it, expect } from "@jest/globals";
import { applyTransforms, TRANSFORMS, TRANSFORM_NAMES, type TransformName } from "../transforms";

/**
 * Transforms are total: a template is community data, so input a transform
 * cannot read must become null — never a throw, never a guessed value.
 */
function t(name: TransformName, input: string | number | null): unknown {
  return TRANSFORMS[name](input);
}

describe("v2 transforms", () => {
  it("every transform returns null (or 0 for dayOffset) on garbage and never throws", () => {
    const garbage = ["", "   ", "???", "lorem ipsum dolor", "\u0000\u0001", "∞∞∞"];
    for (const name of TRANSFORM_NAMES) {
      for (const input of [null, ...garbage]) {
        expect(() => TRANSFORMS[name](input)).not.toThrow();
      }
    }
    for (const name of [
      "money",
      "currency",
      "date",
      "time",
      "flightNumber",
      "iata",
      "integer",
    ] as const) {
      expect(t(name, "???")).toBeNull();
      expect(t(name, null)).toBeNull();
    }
    expect(t("dayOffset", "???")).toBeNull();
  });

  it("string steps: trim, text, upper, lower, titleCase, digits", () => {
    expect(t("trim", "  Hotel Muster  ")).toBe("Hotel Muster");
    expect(t("trim", "   ")).toBeNull();
    expect(t("text", "  Hotel \n  Seeblick\t Muster ")).toBe("Hotel Seeblick Muster");
    expect(t("upper", "fra")).toBe("FRA");
    expect(t("lower", "FRA")).toBe("fra");
    expect(t("titleCase", "HOTEL SEEBLICK-MUSTER")).toBe("Hotel Seeblick-Muster");
    expect(t("titleCase", "äußere straße")).toBe("Äußere Straße");
    expect(t("digits", "Nr. 48-29 13")).toBe("482913");
    expect(t("digits", "keine")).toBeNull();
    expect(t("upper", 42)).toBe("42");
  });

  it("integer reads the first whole number", () => {
    expect(t("integer", "2 Erwachsene")).toBe(2);
    expect(t("integer", "-3")).toBe(-3);
    expect(t("integer", 4.7)).toBe(4);
  });

  it.each([
    ["3.249,00", 3249],
    ["3,249.00", 3249],
    ["3249", 3249],
    ["1 899,00 €", 1899],
    ["EUR 2,437.00", 2437],
    ["12,50", 12.5],
    ["1.234", 1234],
    ["1.234.567,89 EUR", 1234567.89],
    ["€ 99", 99],
  ])("money %s → %s", (input, out) => {
    expect(t("money", input)).toBe(out);
  });

  it.each([
    ["EUR", "EUR"],
    ["€", "EUR"],
    ["1 899,00 €", "EUR"],
    ["Euro", "EUR"],
    ["$", "USD"],
    ["USD", "USD"],
    ["£", "GBP"],
    ["chf", "CHF"],
    ["EUR 2,437.00", "EUR"],
  ])("currency %s → %s", (input, out) => {
    expect(t("currency", input)).toBe(out);
  });

  it.each([
    ["18.05.26", "2026-05-18"],
    ["18.05.2026", "2026-05-18"],
    ["2026-05-18", "2026-05-18"],
    ["4/10/2026", "2026-10-04"],
    ["24 May 2025", "2025-05-24"],
    ["24. Mai 2025", "2025-05-24"],
    ["So., 04 Okt. 26", "2026-10-04"],
    ["3 März 2026", "2026-03-03"],
    ["3. Mrz. 2026", "2026-03-03"],
    ["12 Dec 2025", "2025-12-12"],
    ["12 Dez. 2025", "2025-12-12"],
    ["1 Sept 2026", "2026-09-01"],
    ["May 24, 2025", "2025-05-24"],
    ["Abflug 18.05.26 21:35", "2026-05-18"],
    ["29.02.2024", "2024-02-29"],
  ])("date %s → %s", (input, out) => {
    expect(t("date", input)).toBe(out);
  });

  it("date refuses impossible days and unknown month names", () => {
    expect(t("date", "29.02.2025")).toBeNull();
    expect(t("date", "32.01.2026")).toBeNull();
    expect(t("date", "18.13.26")).toBeNull();
    expect(t("date", "24 Marmalade 2025")).toBeNull();
  });

  it.each([
    ["11:40", "11:40"],
    ["11.40", "11:40"],
    ["11:40 Uhr", "11:40"],
    ["1140", "11:40"],
    ["9:05", "09:05"],
    ["06:25+1", "06:25"],
  ])("time %s → %s", (input, out) => {
    expect(t("time", input)).toBe(out);
  });

  it("time refuses impossible clock readings", () => {
    expect(t("time", "25:00")).toBeNull();
    expect(t("time", "11:75")).toBeNull();
  });

  it("dayOffset: +N is N days later, a missing offset is 0", () => {
    expect(t("dayOffset", "+1")).toBe(1);
    expect(t("dayOffset", "+2")).toBe(2);
    expect(t("dayOffset", "06:25+1")).toBe(1);
    expect(t("dayOffset", "-1")).toBe(-1);
    expect(t("dayOffset", "")).toBe(0);
    expect(t("dayOffset", null)).toBe(0);
    expect(t("dayOffset", "2026-05-18")).toBeNull();
  });

  it("flightNumber uppercases, drops spaces and keeps leading zeros", () => {
    expect(t("flightNumber", "QR 070")).toBe("QR070");
    expect(t("flightNumber", "LH 742")).toBe("LH742");
    expect(t("flightNumber", "gf0086")).toBe("GF0086");
    expect(t("flightNumber", "4U 9512")).toBe("4U9512");
    expect(t("flightNumber", "hello world")).toBeNull();
  });

  it("iata accepts exactly three letters", () => {
    expect(t("iata", " fra ")).toBe("FRA");
    expect(t("iata", "FRAN")).toBeNull();
    expect(t("iata", "F1A")).toBeNull();
  });

  it("applyTransforms chains in order and treats a bare empty string as null", () => {
    expect(applyTransforms("  qr 070 ", ["trim", "flightNumber"])).toBe("QR070");
    expect(applyTransforms(" 3.249,00 ", "money")).toBe(3249);
    expect(applyTransforms("", undefined)).toBeNull();
    expect(applyTransforms("x", undefined)).toBe("x");
  });
});

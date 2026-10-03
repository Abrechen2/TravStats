import { describe, it, expect } from "vitest";

import { formatBaggageAllowance, isBareBaggageNumber, resolveWeightUnit } from "./baggageAllowance";

describe("formatBaggageAllowance (forgejo#186)", () => {
  // stored, preferred unit, shown
  const TABLE: Array<[string | null | undefined, string | undefined, string | null]> = [
    // A bare number takes the preferred unit.
    ["23", "kg", "23 kg"],
    ["23", "lb", "23 lb"],
    ["23,5", "kg", "23,5 kg"],
    ["23.5", "kg", "23.5 kg"],
    [" 23 ", "kg", "23 kg"],
    ["50", "lb", "50 lb"],
    // No preference stored yet (older persisted state): kilograms.
    ["23", undefined, "23 kg"],
    ["23", "stone", "23 kg"],
    // Anything that already says more is shown exactly as stored.
    ["23 kg", "lb", "23 kg"],
    ["23kg", "lb", "23kg"],
    ["2x23kg", "kg", "2x23kg"],
    ["2 x 23", "kg", "2 x 23"],
    ["1 PC", "kg", "1 PC"],
    ["50 lbs", "kg", "50 lbs"],
    ["Handgepäck", "kg", "Handgepäck"],
    ["-23", "kg", "-23"],
    ["23,", "kg", "23,"],
    ["1.234,5", "kg", "1.234,5"],
    // Nothing stays nothing — never a lone unit.
    ["", "kg", null],
    ["   ", "kg", null],
    [null, "kg", null],
    [undefined, "lb", null],
  ];

  it.each(TABLE)("%j with unit %j reads %j", (stored, unit, shown) => {
    expect(formatBaggageAllowance(stored, unit)).toBe(shown);
  });

  it("never converts between kilograms and pounds", () => {
    // The number is the airline's; the preference only names its unit.
    expect(formatBaggageAllowance("23", "lb")).toBe("23 lb");
    expect(formatBaggageAllowance("23 kg", "lb")).toBe("23 kg");
  });
});

describe("isBareBaggageNumber", () => {
  it.each([
    ["23", true],
    [" 23,5 ", true],
    ["23 kg", false],
    ["1 PC", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%j -> %j", (stored, bare) => {
    expect(isBareBaggageNumber(stored)).toBe(bare);
  });
});

describe("resolveWeightUnit", () => {
  it("keeps a known unit and answers kilograms for anything else", () => {
    expect(resolveWeightUnit("lb")).toBe("lb");
    expect(resolveWeightUnit("kg")).toBe("kg");
    expect(resolveWeightUnit(undefined)).toBe("kg");
    expect(resolveWeightUnit(null)).toBe("kg");
    expect(resolveWeightUnit("tonnes")).toBe("kg");
  });
});

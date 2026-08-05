import { describe, it, expect } from "vitest";
import { toYearKeyed } from "../yearKeyed";

describe("toYearKeyed", () => {
  it("converts JSON string keys to numbers", () => {
    const result = toYearKeyed({ "2024": ["DE"], "2026": ["ES", "IT"] });
    expect(result).toEqual({ 2024: ["DE"], 2026: ["ES", "IT"] });
    // Numeric lookup is the whole point — the year selector works in numbers.
    expect(result?.[2026]).toEqual(["ES", "IT"]);
  });

  // "Backend did not send the index" and "index is empty" must stay
  // distinguishable: the first falls back to the lifetime country set, the
  // second legitimately reports zero countries for that year.
  it("passes undefined through rather than inventing an empty index", () => {
    expect(toYearKeyed(undefined)).toBeUndefined();
  });

  it("returns an empty object for an empty index", () => {
    expect(toYearKeyed({})).toEqual({});
  });

  it("drops non-numeric keys instead of coercing them to NaN", () => {
    const result = toYearKeyed({ "2024": ["DE"], unknown: ["XX"] });
    expect(result).toEqual({ 2024: ["DE"] });
  });
});

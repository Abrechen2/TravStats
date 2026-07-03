import { describe, it, expect } from "vitest";
import { deriveCruiseColor, resolveCruiseColor, CRUISE_DISTINCT_PALETTE } from "./cruiseColor";

describe("deriveCruiseColor", () => {
  it("is stable for the same id", () => {
    expect(deriveCruiseColor("abc")).toEqual(deriveCruiseColor("abc"));
  });
  it("returns a palette color", () => {
    expect(CRUISE_DISTINCT_PALETTE).toContainEqual(deriveCruiseColor("abc"));
  });
  it("spreads different ids across the palette (not all identical)", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
    const distinct = new Set(ids.map((i) => deriveCruiseColor(i).join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("resolveCruiseColor", () => {
  it("uses cruise.color hex when present", () => {
    expect(resolveCruiseColor({ id: "x", color: "#ff8800" })).toEqual([255, 136, 0]);
  });
  it("falls back to derived when color is null/absent/invalid", () => {
    expect(resolveCruiseColor({ id: "x", color: null })).toEqual(deriveCruiseColor("x"));
    expect(resolveCruiseColor({ id: "x", color: "not-a-hex" })).toEqual(deriveCruiseColor("x"));
    expect(resolveCruiseColor({ id: "x" })).toEqual(deriveCruiseColor("x"));
  });
});

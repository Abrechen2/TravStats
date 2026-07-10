import { describe, it, expect } from "vitest";
import { normalizeAppearance } from "./mapAppearance";

describe("normalizeAppearance", () => {
  it("coerces legacy width/size enum strings to their scale numbers", () => {
    const out = normalizeAppearance({
      cruiseRouteWidth: "thick",
      flightRouteWidth: "thin",
      cruiseMarkerSize: "off",
      flightMarkerSize: "l",
    });
    expect(out.cruiseRouteWidth).toBe(1.6);
    expect(out.flightRouteWidth).toBe(0.6);
    expect(out.cruiseMarkerSize).toBe(0);
    expect(out.flightMarkerSize).toBe(1.45);
  });

  it("passes numeric values through unchanged", () => {
    const out = normalizeAppearance({ cruiseRouteWidth: 1.3, cruiseMarkerSize: 0, cruiseArrowScale: 2 });
    expect(out.cruiseRouteWidth).toBe(1.3);
    expect(out.cruiseMarkerSize).toBe(0);
    expect(out.cruiseArrowScale).toBe(2);
  });

  it("drops unrecognised width/size values (falls back to consumer default)", () => {
    const out = normalizeAppearance({ cruiseRouteWidth: "bogus" });
    expect(out.cruiseRouteWidth).toBeUndefined();
  });

  it("preserves unrelated fields", () => {
    const out = normalizeAppearance({ styleId: "dark", portColor: [1, 2, 3] });
    expect(out.styleId).toBe("dark");
    expect(out.portColor).toEqual([1, 2, 3]);
  });
});

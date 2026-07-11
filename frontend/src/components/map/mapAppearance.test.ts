import { beforeEach, describe, it, expect } from "vitest";
import { loadFlightColorConfig, normalizeAppearance, saveMapAppearance } from "./mapAppearance";
import { DEFAULT_FLIGHT_COLORS } from "../../lib/flightColor";

const KEY = "mapAppearance.v2";

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

// The flight colour mode replaced the old single `routeColor` field. An
// existing user's map must not change under them just because they updated —
// these three paths are the whole contract (see lib/flightColor.ts).
describe("loadFlightColorConfig — migrating an existing user's localStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("an existing user with routeColor: null lands in status mode (it was written on every mount, never a deliberate pick)", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ styleId: "dark", routeColor: null }));
    const cfg = loadFlightColorConfig();
    expect(cfg.mode).toBe("status");
    expect(cfg.colors.past).toEqual(DEFAULT_FLIGHT_COLORS.past);
    expect(cfg.colors.upcoming).toEqual(DEFAULT_FLIGHT_COLORS.upcoming);
  });

  it("an existing user with a picked colour lands in solid mode with that colour", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ routeColor: [7, 8, 9] }));
    const cfg = loadFlightColorConfig();
    expect(cfg.mode).toBe("solid");
    expect(cfg.colors.solid).toEqual([7, 8, 9]);
  });

  it("a fresh user (nothing stored) gets status mode with the default pair", () => {
    const cfg = loadFlightColorConfig();
    expect(cfg.mode).toBe("status");
    expect(cfg.colors.past).toEqual(DEFAULT_FLIGHT_COLORS.past);
    expect(cfg.colors.upcoming).toEqual(DEFAULT_FLIGHT_COLORS.upcoming);
  });

  it("round-trips a saved mode + colours through the shared appearance blob", () => {
    saveMapAppearance({
      flightColorMode: "status",
      flightColors: { ...DEFAULT_FLIGHT_COLORS, past: [1, 2, 3] },
    });
    const cfg = loadFlightColorConfig();
    expect(cfg.mode).toBe("status");
    expect(cfg.colors.past).toEqual([1, 2, 3]);
    // …and it survives alongside the rest of the blob.
    saveMapAppearance({ styleId: "voyager" });
    expect(loadFlightColorConfig().colors.past).toEqual([1, 2, 3]);
  });
});

import { describe, it, expect } from "vitest";
import {
  DASHBOARD_TABS,
  TAB_MODE_REGISTRY,
  isDashboardTab,
  isModeForTab,
  defaultModeForTab,
} from "../dashboard";

describe("dashboard tab + mode registry", () => {
  it("exposes exactly the six agreed tabs", () => {
    expect(DASHBOARD_TABS).toEqual(["all", "flight", "cruise", "poi", "lodging", "tour"]);
  });

  it("isDashboardTab narrows arbitrary strings", () => {
    expect(isDashboardTab("flight")).toBe(true);
    expect(isDashboardTab("hexagon")).toBe(false);
    expect(isDashboardTab(undefined)).toBe(false);
  });

  it("each tab has a non-empty ordered mode list with a valid default", () => {
    for (const tab of DASHBOARD_TABS) {
      const entry = TAB_MODE_REGISTRY[tab];
      expect(entry.modes.length).toBeGreaterThan(0);
      expect(entry.modes).toContain(entry.default);
    }
  });

  it("isModeForTab validates cross-tab boundaries", () => {
    expect(isModeForTab("flight", "routes")).toBe(true);
    expect(isModeForTab("flight", "sea-routes")).toBe(false);
    expect(isModeForTab("cruise", "sea-routes")).toBe(true);
    expect(isModeForTab("all", "overview")).toBe(true);
    expect(isModeForTab("poi", "routes")).toBe(false);
  });

  // Owner ruling 2026-09-20: "Globus soll ueberall genutzt werden" — every tab
  // that HAS a globe opens on it, which since POI gained one the same day is
  // all six.
  // The second argument states the DEVICE. jsdom has no WebGL2, so a bare
  // call here would measure the fallback and say nothing about the ruling.
  it("defaultModeForTab returns the registered default", () => {
    expect(defaultModeForTab("flight", true)).toBe("globe");
    expect(defaultModeForTab("cruise", true)).toBe("globe");
    expect(defaultModeForTab("poi", true)).toBe("globe");
    expect(defaultModeForTab("all", true)).toBe("globe");
  });

  it("registers the lodging tab", () => {
    expect(DASHBOARD_TABS).toContain("lodging");
    expect(TAB_MODE_REGISTRY.lodging.modes).toContain("map");
    expect(defaultModeForTab("lodging", true)).toBe("globe");
  });

  it("registers the tour tab", () => {
    expect(DASHBOARD_TABS).toContain("tour");
    expect(TAB_MODE_REGISTRY.tour.modes).toEqual(["routes", "globe"]);
    expect(defaultModeForTab("tour", true)).toBe("globe");
    expect(isModeForTab("tour", "globe")).toBe(true);
    expect(isModeForTab("tour", "markers")).toBe(false);
  });
});

/**
 * The globe became the default on all six tabs and nothing asked the device.
 *
 * `liteMode` is dataset-driven only, and `webgl2Available` is consulted by the
 * FLAT map alone — which is exactly where it has a fallback: without WebGL2 it
 * draws `NativeRoutesLayer` and shows a notice. A reader on such a device used
 * to land on `routes` and see that. After the ruling they landed on a globe
 * that cannot draw at all, with no fallback and nothing saying why.
 */
describe("a device without WebGL2 does not open on a globe", () => {
  it("falls back to the tab's flat default on every tab", () => {
    expect(defaultModeForTab("all", false)).toBe("overview");
    expect(defaultModeForTab("flight", false)).toBe("routes");
    expect(defaultModeForTab("cruise", false)).toBe("sea-routes");
    expect(defaultModeForTab("poi", false)).toBe("markers");
    expect(defaultModeForTab("lodging", false)).toBe("map");
    expect(defaultModeForTab("tour", false)).toBe("routes");
  });

  it("every flat fallback is a mode that tab actually offers", () => {
    for (const tab of DASHBOARD_TABS) {
      expect(isModeForTab(tab, defaultModeForTab(tab, false))).toBe(true);
    }
  });

  it("still opens on the globe where the device can draw one", () => {
    expect(defaultModeForTab("flight", true)).toBe("globe");
  });
});

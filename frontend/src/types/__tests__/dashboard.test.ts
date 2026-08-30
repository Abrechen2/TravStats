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

  it("defaultModeForTab returns the registered default", () => {
    expect(defaultModeForTab("flight")).toBe("routes");
    expect(defaultModeForTab("cruise")).toBe("sea-routes");
    expect(defaultModeForTab("poi")).toBe("markers");
    expect(defaultModeForTab("all")).toBe("overview");
  });

  it("registers the lodging tab", () => {
    expect(DASHBOARD_TABS).toContain("lodging");
    expect(TAB_MODE_REGISTRY.lodging.modes).toContain("map");
    expect(defaultModeForTab("lodging")).toBe("map");
  });

  it("registers the tour tab", () => {
    expect(DASHBOARD_TABS).toContain("tour");
    expect(TAB_MODE_REGISTRY.tour.modes).toEqual(["routes", "globe"]);
    expect(defaultModeForTab("tour")).toBe("routes");
    expect(isModeForTab("tour", "globe")).toBe(true);
    expect(isModeForTab("tour", "markers")).toBe(false);
  });
});

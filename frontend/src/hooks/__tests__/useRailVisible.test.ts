import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useRailOffered, useRailVisible } from "../useRailVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Rail answers to TWO conditions (spec 2026-09-25-rail-domain): the instance
 * beta switch and the user's own domain choice. "Unknown" (the flag before
 * GET /settings answers) hides chrome — it must never flash rail into view.
 */
describe("useRailVisible", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: true });
  });

  it("shows rail when the instance allows it and the user wants it", () => {
    expect(renderHook(() => useRailVisible()).result.current).toBe(true);
  });

  it.each([
    ["off", false],
    ["unknown (not loaded yet)", null],
  ])("hides rail while the beta flag is %s, even with the domain on", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    expect(renderHook(() => useRailVisible()).result.current).toBe(false);
  });

  it("hides rail when the user has the domain off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    expect(renderHook(() => useRailVisible()).result.current).toBe(false);
  });
});

describe("useRailOffered — where the domain is switched on", () => {
  it("offers rail on a beta instance to a user who has not enabled it yet", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    expect(renderHook(() => useRailOffered()).result.current).toBe(true);
  });

  it("does not offer rail while the beta flag is off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    expect(renderHook(() => useRailOffered()).result.current).toBe(false);
  });
});

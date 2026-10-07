import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useBusOffered, useBusVisible } from "../useBusVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Bus answers to TWO conditions (spec 2026-10-07-bus-domain-design): the instance
 * beta switch and the user's own domain choice. "Unknown" (the flag before
 * GET /settings answers) hides chrome — it must never flash bus into view.
 */
describe("useBusVisible", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "bus"], betaFeaturesEnabled: true });
  });

  it("shows bus when the instance allows it and the user wants it", () => {
    expect(renderHook(() => useBusVisible()).result.current).toBe(true);
  });

  it.each([
    ["off", false],
    ["unknown (not loaded yet)", null],
  ])("hides bus while the beta flag is %s, even with the domain on", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    expect(renderHook(() => useBusVisible()).result.current).toBe(false);
  });

  it("hides bus when the user has the domain off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    expect(renderHook(() => useBusVisible()).result.current).toBe(false);
  });
});

describe("useBusOffered — where the domain is switched on", () => {
  it("offers bus on a beta instance to a user who has not enabled it yet", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    expect(renderHook(() => useBusOffered()).result.current).toBe(true);
  });

  it("does not offer bus while the beta flag is off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
    expect(renderHook(() => useBusOffered()).result.current).toBe(false);
  });
});

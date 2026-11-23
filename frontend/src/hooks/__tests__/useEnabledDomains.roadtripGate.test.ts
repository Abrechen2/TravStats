import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useEnabledDomains } from "../useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Roadtrips and tours left beta for 2.8 (owner, 2026-11-23): only the reader's
 * own switch decides, whatever the instance's beta flag says.
 */
describe("useEnabledDomains — roadtrips and tours are not beta-gated", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "lodging", "roadtrip", "tour"],
      betaFeaturesEnabled: null,
    });
  });

  it.each([
    ["not loaded yet", null],
    ["off", false],
    ["on", true],
  ])("shows roadtrips and tours without the beta flag (%s)", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.isEnabled("roadtrip")).toBe(true);
    expect(result.current.isEnabled("tour")).toBe(true);
  });

  it("still respects the reader's own toggle", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false, enabledDomains: ["flight"] });
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.isEnabled("roadtrip")).toBe(false);
    expect(result.current.isEnabled("tour")).toBe(false);
  });
});

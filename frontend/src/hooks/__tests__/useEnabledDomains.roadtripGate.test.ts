import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useEnabledDomains } from "../useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Roadtrips are beta in 2.7, and this hook is the whole gate: every surface
 * that shows a domain — nav, logbook tabs, dashboard tab, statistics tab,
 * overview — asks it. So the one thing to pin is that the domain does not
 * exist for a reader while the instance switch is closed, whatever their own
 * toggle says, and that nothing else changes.
 */
describe("useEnabledDomains — the roadtrip beta gate", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "lodging", "roadtrip"],
      betaFeaturesEnabled: null,
    });
  });

  it.each([
    ["not loaded yet", null],
    ["off", false],
  ])("hides roadtrips while the beta switch is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.enabled).toEqual(["flight", "lodging"]);
    expect(result.current.isEnabled("roadtrip")).toBe(false);
    expect(result.current.isEnabled("lodging")).toBe(true);
  });

  it("shows roadtrips once the beta switch is on and the reader enabled them", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.isEnabled("roadtrip")).toBe(true);
  });

  it("still respects the reader's own toggle with the beta switch on", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true, enabledDomains: ["flight"] });
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.isEnabled("roadtrip")).toBe(false);
  });
});

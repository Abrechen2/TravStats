import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { vi } from "vitest";
import { usePlacesAccess, usePlacesVisible } from "../usePlacesVisible";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Since 2026-09-05 the Places domain answers to the user's domain choice alone.
 * The instance beta flag used to be a second condition, and its one-request
 * "unknown" window on a cold load is what once bounced /places on every
 * refresh; that window no longer reaches this rule, so the flag's value --
 * true, false or not loaded -- must make no difference here.
 */
describe("usePlacesAccess: the user's domain choice alone", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi"],
      betaFeaturesEnabled: null,
    });
  });

  it.each([
    ["unknown (not loaded yet)", null],
    ["off", false],
    ["on", true],
  ])("reports allowed with the domain on while the beta flag is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).toBe("allowed");
  });

  it("reports denied when the user has switched the domain off", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true, enabledDomains: ["flight"] });
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).toBe("denied");
  });

  it("never reports pending: the answer is known at first render", () => {
    const { result } = renderHook(() => usePlacesAccess());
    expect(result.current).not.toBe("pending");
  });

  it("usePlacesVisible is the boolean of the same answer", () => {
    const { result } = renderHook(() => usePlacesVisible());
    expect(result.current).toBe(true);
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { result: off } = renderHook(() => usePlacesVisible());
    expect(off.current).toBe(false);
  });
});

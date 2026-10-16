import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { resolveStatsTab, visibleStatsTabs } from "../statsTabAccess";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * The statistics strip and its deep link receive the enabled domains with every
 * beta switch already applied (`useEnabledDomains`), so rail, rental and bus
 * behind a closed switch have neither a tab nor a deep link — the leak rail's
 * tab once had. Asked through the real hook, so the gate cannot be dropped on
 * the way between the two.
 */
function enabledWith(flag: boolean | null) {
  useSettingsStore.setState({
    enabledDomains: ["flight", "rail", "rental", "bus"],
    betaFeaturesEnabled: flag,
  });
  // Unmounted at once: the next store write must not re-render a stale hook.
  const { result, unmount } = renderHook(() => useEnabledDomains());
  const { enabled } = result.current;
  unmount();
  return enabled;
}

describe("statistics tab access — the beta-gated domains", () => {
  beforeEach(() => useSettingsStore.setState({ betaFeaturesEnabled: null }));

  it.each([false, null])("draws no rail, rental or bus tab while the switch is %s", (flag) => {
    expect(visibleStatsTabs(enabledWith(flag), "denied")).toEqual(["flight"]);
  });

  it("draws them once the switch is open", () => {
    expect(visibleStatsTabs(enabledWith(true), "denied")).toEqual([
      "flight",
      "rail",
      "rental",
      "bus",
    ]);
  });

  it.each(["rail", "rental", "bus"] as const)(
    "sends a deep link to %s to the overview while the switch is closed, and opens it once open",
    (tab) => {
      expect(resolveStatsTab(tab, enabledWith(false), "denied")).toBe("all");
      expect(resolveStatsTab(tab, enabledWith(true), "denied")).toBe(tab);
    }
  );

  it("opens a gated tab only for a user who has the domain", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    const enabled = renderHook(() => useEnabledDomains()).result.current.enabled;
    expect(resolveStatsTab("rail", enabled, "denied")).toBe("all");
  });

  // Ferry had no statistics tab at all, beta switch open or not.
  it("draws a ferry tab and opens its deep link once the ferry switch is open", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "ferry"], betaFeaturesEnabled: true });
    const { result, unmount } = renderHook(() => useEnabledDomains());
    const { enabled } = result.current;
    unmount();
    expect(visibleStatsTabs(enabled, "denied")).toEqual(["flight", "ferry"]);
    expect(resolveStatsTab("ferry", enabled, "denied")).toBe("ferry");
  });
});

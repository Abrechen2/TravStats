import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { resolveStatsTab, visibleStatsTabs } from "../statsTabAccess";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";
import type { DomainKey } from "../../shared/domains";

/**
 * The statistics strip and its deep link receive the enabled domains with the
 * remaining beta switch already applied (`useEnabledDomains`). Rail left beta
 * in 2.7.0-rc.20, rental, bus and ferry on 2026-10-26 (owner): each keeps its
 * tab with the switch closed, and loses it only when the user switches the
 * domain off. Asked through the real hook, so a gate put back on the way
 * between the two would show here.
 */
function enabledWith(domains: DomainKey[], flag: boolean | null) {
  useSettingsStore.setState({ enabledDomains: domains, betaFeaturesEnabled: flag });
  // Unmounted at once: the next store write must not re-render a stale hook.
  const { result, unmount } = renderHook(() => useEnabledDomains());
  const { enabled } = result.current;
  unmount();
  return enabled;
}

describe("statistics tab access — the domains out of beta", () => {
  beforeEach(() => useSettingsStore.setState({ betaFeaturesEnabled: null }));

  it.each([false, null])("draws rail, rental, bus and ferry while the switch is %s", (flag) => {
    const all: DomainKey[] = ["flight", "rail", "rental", "bus", "ferry"];
    expect(visibleStatsTabs(enabledWith(all, flag), "denied")).toEqual(all);
  });

  it.each(["rail", "rental", "bus", "ferry"] as const)(
    "opens a %s deep link with the switch closed, and only while the user has the domain",
    (tab) => {
      expect(resolveStatsTab(tab, enabledWith(["flight", tab], false), "denied")).toBe(tab);
      expect(resolveStatsTab(tab, enabledWith(["flight"], false), "denied")).toBe("all");
      expect(visibleStatsTabs(enabledWith(["flight"], false), "denied")).toEqual(["flight"]);
    }
  );
});

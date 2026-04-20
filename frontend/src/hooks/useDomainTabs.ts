import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DomainKey } from "../shared/domains";
import { useEnabledDomains } from "./useEnabledDomains";

export interface DomainTabConfig<T extends string> {
  id: T;
  label: string;
  icon?: string;
  /**
   * When set, the tab is only visible if this domain is in the user's
   * enabledDomains. Tabs without a `requiresDomain` are always visible
   * (use this for the "Allgemein" tab).
   */
  requiresDomain?: DomainKey;
}

export interface UseDomainTabsOptions<T extends string> {
  /**
   * Candidate tabs in render order. Tabs whose `requiresDomain` is not
   * currently enabled are filtered out before being returned.
   */
  tabConfig: ReadonlyArray<DomainTabConfig<T>>;
  /** Fallback tab id when the URL param is missing / invalid / disabled. */
  defaultTab: T;
  /** URL param name holding the tab id. Defaults to `"tab"`. */
  paramName?: string;
}

export interface UseDomainTabsReturn<T extends string> {
  /** Tabs that are actually visible given the current enabledDomains. */
  tabs: Array<{ id: T; label: string; icon?: string }>;
  /** The tab the user is currently on. Never returns a tab not in `tabs`. */
  activeTab: T;
  /**
   * Setter. Also writes the tab id to the URL param so a reload keeps
   * the user where they were.
   */
  setActiveTab: (id: T) => void;
}

/**
 * Shared tab-state hook for the domain-separation pattern used by
 * SettingsPage, AdminPage, and AdvancedStatsPage. Factored out so the
 * three pages don't each re-implement tab filtering by enabledDomains,
 * URL sync, and the drift guard that kicks in when a user disables the
 * domain their active tab points to.
 *
 * Per-page section state stays inside each page — the three pages
 * handle sections differently (sidebar vs none vs chip row), so a
 * generic section abstraction wasn't worth the complexity.
 */
export function useDomainTabs<T extends string>({
  tabConfig,
  defaultTab,
  paramName = "tab",
}: UseDomainTabsOptions<T>): UseDomainTabsReturn<T> {
  const [searchParams, setSearchParams] = useSearchParams();
  const { enabled } = useEnabledDomains();

  const tabs = useMemo<Array<{ id: T; label: string; icon?: string }>>(
    () =>
      tabConfig
        .filter((tab) => tab.requiresDomain === undefined || enabled.includes(tab.requiresDomain))
        .map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon })),
    [tabConfig, enabled]
  );

  const initialTabParam = searchParams.get(paramName) as T | null;
  const [activeTab, setActiveTabState] = useState<T>(
    initialTabParam !== null && tabs.some((tab) => tab.id === initialTabParam)
      ? initialTabParam
      : defaultTab
  );

  // Drift guard: if the user disables the domain whose tab is active
  // (e.g. they toggle cruise off in the Modules section while sitting
  // on the cruise tab), fall back to defaultTab. Without this the tab
  // bar would drop the cruise button but activeTab state would still
  // point at "cruise", producing split-brain renders until reload.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTabState(defaultTab);
    }
  }, [tabs, activeTab, defaultTab]);

  // Sync tab to URL param so reload + link-copy preserves state.
  // Replace rather than push so the browser Back button steps through
  // user history, not every internal tab switch.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set(paramName, activeTab);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return { tabs, activeTab, setActiveTab: setActiveTabState };
}

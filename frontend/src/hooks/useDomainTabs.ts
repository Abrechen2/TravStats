import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "./useTranslation";
import { useToastStore } from "../store/toastStore";
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
  /**
   * Override for the drift-handling side effect. The hook normally shows
   * a toast ("Cruise-Tab nicht mehr verfügbar …") when the user's active
   * tab disappears because the domain was disabled. Tests pass a spy
   * here to assert drift without rendering the toast store.
   */
  onDrift?: (disabledTabId: T, fallbackTabId: T) => void;
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
  onDrift,
}: UseDomainTabsOptions<T>): UseDomainTabsReturn<T> {
  const [searchParams] = useSearchParams();
  const { enabled } = useEnabledDomains();
  const { t } = useTranslation(["common"]);
  const addToast = useToastStore((state) => state.addToast);

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

  const lastTabsRef = useRef(tabs);

  // Drift guard: if the user disables the domain whose tab is active
  // (e.g. they toggle cruise off in the Modules section while sitting
  // on the cruise tab), fall back to defaultTab. Without this the tab
  // bar would drop the cruise button but activeTab state would still
  // point at "cruise", producing split-brain renders until reload.
  //
  // A silent redirect confuses users — they clicked a toggle five sections
  // away and suddenly landed on Allgemein. The toast explains the cause.
  // The callback override lets tests observe drift without mounting the
  // toast store.
  useEffect(() => {
    const previousTabs = lastTabsRef.current;
    lastTabsRef.current = tabs;
    if (tabs.some((tab) => tab.id === activeTab)) return;
    // Was this tab ever visible in the previous render? If not, the user
    // hand-typed a bogus ?tab=nonsense — no toast for that, just silently
    // normalise. Toast fires only for real mid-session drift.
    const wasVisibleBefore = previousTabs.some((tab) => tab.id === activeTab);
    setActiveTabState(defaultTab);
    if (!wasVisibleBefore) return;
    if (onDrift) {
      onDrift(activeTab, defaultTab);
      return;
    }
    const disabledLabel = tabConfig.find((tab) => tab.id === activeTab)?.label ?? String(activeTab);
    addToast(
      "info",
      t("common:domainTabs.driftFallback", {
        tab: disabledLabel,
        defaultValue: 'Der Tab „{{tab}}" ist deaktiviert — zurück zu Allgemein.',
      })
    );
  }, [tabs, activeTab, defaultTab, addToast, t, tabConfig, onDrift]);

  // URL sync happens at the CONSUMER layer, not inside this hook.
  //
  // Reason: pages like SettingsPage also write `?section=…` to the URL.
  // react-router's `setSearchParams` does NOT sequence functional
  // updates the way React's `setState` does — the second call in a
  // render cycle sees the ORIGINAL URL, not the patched one. Two
  // independent effects therefore clobber each other, and whichever
  // runs last wins.
  //
  // The consumer must bundle `?tab=` together with its own params into
  // a SINGLE `setSearchParams` call. See SettingsPage for the canonical
  // pattern: one `useEffect` keyed on `[activeTab, activeSection]` that
  // writes both keys at once.

  return { tabs, activeTab, setActiveTab: setActiveTabState };
}

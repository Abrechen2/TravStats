import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DashboardMode,
  DashboardTab,
  defaultModeForTab,
  isDashboardTab,
  isModeForTab,
} from "../types/dashboard";
import { useEnabledDomains } from "./useEnabledDomains";
import { useSettingsStore } from "../store/settingsStore";
import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";

const LAST_MODE_KEY = "travstats:dashboard:lastMode";

interface DashboardRouteState {
  tab: DashboardTab;
  mode: DashboardMode;
  setTab(next: DashboardTab): void;
  setMode(next: DashboardMode): void;
}

function readLastModes(): Partial<Record<DashboardTab, DashboardMode>> {
  try {
    const raw = window.localStorage.getItem(LAST_MODE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Partial<Record<DashboardTab, DashboardMode>>;
  } catch {
    return {};
  }
}

function writeLastMode(tab: DashboardTab, mode: DashboardMode): void {
  const current = readLastModes();
  const next = { ...current, [tab]: mode };
  try {
    window.localStorage.setItem(LAST_MODE_KEY, JSON.stringify(next));
  } catch {
    // Silent — localStorage full / disabled; not worth surfacing.
  }
}

export function useDashboardRoute(): DashboardRouteState {
  const { tab: rawTab } = useParams<{ tab?: string }>();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();

  const { isEnabled } = useEnabledDomains();
  const domainsLoaded = useSettingsStore((st) => st.enabledDomainsLoaded);

  const tab: DashboardTab = isDashboardTab(rawTab) ? rawTab : "all";

  // If the URL tab was invalid, normalise it once so the URL doesn't stick
  // at /dashboard/spaceship.
  //
  // A tab naming a domain the user does NOT have is the same class of problem
  // and was not caught: /dashboard/lodging rendered the lodging tab, its tab
  // strip entry and its "+ Hotel hinzufügen" button even with lodging switched
  // off — measured with enabledDomains ["flight","cruise"].
  //
  // The `enabledDomainsLoaded` check is what keeps this from becoming the
  // route-guard bug in a new place: before the settings fetch answers, the
  // store still holds its initial ["flight"], and normalising then would throw
  // the user off a tab they really have.
  useEffect(() => {
    if (rawTab === undefined) return;
    if (!isDashboardTab(rawTab)) {
      navigate("/dashboard", { replace: true });
      return;
    }
    const asDomain = (DOMAIN_KEYS as readonly string[]).includes(rawTab)
      ? (rawTab as DomainKey)
      : null;
    if (asDomain !== null && domainsLoaded && !isEnabled(asDomain)) {
      navigate("/dashboard", { replace: true });
    }
  }, [rawTab, navigate, domainsLoaded, isEnabled]);

  // Single-tab semantics: changes from another tab/window propagate only on the
  // next URL change in this tab — we do not listen for `storage` events.
  const mode: DashboardMode = useMemo(() => {
    const urlMode = search.get("mode");
    if (urlMode && isModeForTab(tab, urlMode)) return urlMode;
    const stored = readLastModes()[tab];
    if (stored && isModeForTab(tab, stored)) return stored;
    return defaultModeForTab(tab);
  }, [search, tab]);

  // Persist the resolved mode so a later tab-switch round-trip
  // (/dashboard/flight?mode=heatmap → /dashboard/cruise → /dashboard/flight)
  // can fall back to it from localStorage. Previously only `setMode` wrote;
  // a direct URL navigation set the mode for the current view but left
  // localStorage empty, which broke the "last-used mode per tab" promise.
  useEffect(() => {
    const urlMode = search.get("mode");
    if (urlMode && isModeForTab(tab, urlMode)) {
      writeLastMode(tab, urlMode);
    }
  }, [search, tab]);

  const setTab = useCallback(
    (next: DashboardTab) => {
      if (next === "all") {
        navigate("/dashboard");
      } else {
        navigate(`/dashboard/${next}`);
      }
    },
    [navigate]
  );

  const setMode = useCallback(
    (next: DashboardMode) => {
      if (!isModeForTab(tab, next)) return;
      writeLastMode(tab, next);
      const nextSearch = new URLSearchParams(search);
      nextSearch.set("mode", next);
      setSearch(nextSearch, { replace: true });
    },
    [tab, search, setSearch]
  );

  return { tab, mode, setTab, setMode };
}

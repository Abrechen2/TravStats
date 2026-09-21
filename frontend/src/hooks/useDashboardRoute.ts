import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DashboardMode,
  DashboardTab,
  defaultModeForTab,
  isDashboardTab,
  isModeForTab,
  projectionOfMode,
  TAB_MODE_REGISTRY,
} from "../types/dashboard";
import { useEnabledDomains } from "./useEnabledDomains";
import { useSettingsStore } from "../store/settingsStore";
import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";

const LAST_MODE_KEY = "travstats:dashboard:lastMode";
/**
 * The last projection the reader chose — ONE choice for the whole dashboard,
 * not one per tab.
 *
 * Separate from the mode because the two answer different questions. "Heatmap
 * or routes" is a question about flights, and asking it again of cruises would
 * be nonsense; "globe or flat" is a question about the map itself and has the
 * same answer everywhere. It was stored per tab until 2026-09-21, which is why
 * switching the "Alle" tab to the globe left every other tab on whatever it
 * showed before — a tester read that as the switch not being taken (Alex,
 * 2026-09-20), and he is right: nobody asks for a globe meaning "here only".
 *
 * "journey" is a view of one trip and says nothing about globe-vs-flat, so
 * picking it leaves this untouched; that is what lets the journey view open on
 * the projection the reader last asked for rather than on a hardcoded one
 * (owner ruling, 2026-09-20).
 */
const LAST_PROJECTION_KEY = "travstats:dashboard:lastProjection";

export type MapProjectionChoice = "globe" | "flat";

interface DashboardRouteState {
  tab: DashboardTab;
  mode: DashboardMode;
  /**
   * Globe or flat, for a view that can be drawn either way and has to pick
   * without being a mode itself (the "Reise" view). Follows the last mode the
   * reader chose that HAD a projection; the globe when they never chose one.
   */
  projection: MapProjectionChoice;
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

/**
 * `undefined` when the reader has never chosen, which is not the same as
 * "flat" — an unanswered question falls through to the globe default.
 *
 * A value written before 2026-09-21 is the old per-tab OBJECT. It is ignored
 * rather than migrated: the reader's next mode click writes the new shape,
 * and guessing which of up to six entries was meant would be inventing an
 * answer nobody gave.
 */
function readLastProjection(): MapProjectionChoice | undefined {
  try {
    const raw = window.localStorage.getItem(LAST_PROJECTION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed === "globe" || parsed === "flat" ? parsed : undefined;
  } catch {
    return undefined;
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

  const projection = projectionOfMode(mode);
  if (projection === null) return;
  try {
    window.localStorage.setItem(LAST_PROJECTION_KEY, JSON.stringify(projection));
  } catch {
    // Same silence, same reason.
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

    const storedRaw = readLastModes()[tab];
    const stored = storedRaw && isModeForTab(tab, storedRaw) ? storedRaw : undefined;
    const wanted = readLastProjection();

    // A mode that says nothing about the projection ("journey") is the
    // reader's view choice and outranks the projection question entirely —
    // it is drawable either way, so there is nothing to reconcile.
    if (stored !== undefined && projectionOfMode(stored) === null) return stored;

    // The projection carries ACROSS tabs, the data view does not. So a tab
    // whose remembered mode disagrees with the projection the reader last
    // asked for follows the projection: to the globe, or back to the flat
    // view this tab opens on. What it must not do is keep drawing a flat map
    // because that is what this particular tab saw last.
    if (wanted === "globe")
      return isModeForTab(tab, "globe") ? "globe" : (stored ?? defaultModeForTab(tab));
    if (wanted === "flat") {
      if (stored !== undefined && projectionOfMode(stored) === "flat") return stored;
      return TAB_MODE_REGISTRY[tab].flatDefault;
    }

    return stored ?? defaultModeForTab(tab);
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

  // The ACTIVE mode answers this whenever it can — reading storage first
  // would be one render behind, because a URL-set mode is persisted in an
  // effect. Storage is only consulted for a mode that says nothing about a
  // projection ("journey"), which is the whole reason it exists.
  const projection = useMemo<MapProjectionChoice>(
    () => projectionOfMode(mode) ?? readLastProjection() ?? "globe",
    [tab, mode]
  );

  return { tab, mode, projection, setTab, setMode };
}

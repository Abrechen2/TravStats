import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useEnabledDomains } from "./useEnabledDomains";
import { useToursVisible } from "./useToursVisible";
import { useRailVisible } from "./useRailVisible";
import { useRentalVisible } from "./useRentalVisible";
import { useBusVisible } from "./useBusVisible";
import { useDashboardCountsStore } from "../store/dashboardCountsStore";
import { useDashboardDomainFilterStore } from "../store/dashboardDomainFilterStore";
import { useDashboardRoute } from "./useDashboardRoute";
import {
  FILTER_DOMAIN_ORDER,
  isFilterDomainKey,
  parseDomainsParam,
  type FilterDomainKey,
} from "../shared/dashboardDomainFilter";

export interface DomainFilterRow {
  readonly key: FilterDomainKey;
  readonly visible: boolean;
  /** `null` where the surface cannot know it — see DomainFilterRow. */
  readonly count: number | null;
  /** Row carries the "Beta" badge — decision: instance beta-registry membership,
   *  not a gate (a row this hook returns already passed the gate). */
  readonly beta: boolean;
}

export interface DashboardDomainFilterResult {
  readonly rows: readonly DomainFilterRow[];
  readonly visibleCount: number;
  readonly totalCount: number;
  /** All available rows are unticked (decision 6's empty state). */
  readonly isEmpty: boolean;
  /** Viewing a shared link's selection rather than the reader's own. */
  readonly isLinkMode: boolean;
  isVisible(key: FilterDomainKey): boolean;
  toggle(key: FilterDomainKey): void;
  showAll(): void;
  showNone(): void;
  isolate(key: FilterDomainKey): void;
  adoptLink(): void;
  /** Previews the reader's own stored selection while a link stays in the URL
   *  — "Meine Auswahl", the other half of decision 3's adopt/preview pair. */
  viewOwnSelection(): void;
}

/**
 * The rows still carrying a beta label: `tour` and `roadtrip` behind the
 * `roadtrips` key, and `rail` behind its own `railDomain` key
 * (`config/betaFeatures.ts`). flight/cruise/lodging/poi carry no beta entry
 * at all. A row only reaches `rows` once its own gate is open, so this flag
 * is purely informational — "still labelled beta on this instance", not a
 * second gate.
 */
const BETA_ROWS = new Set<FilterDomainKey>(["tour", "roadtrip", "rail", "bus", "rental"]);

/**
 * Rows with no single-domain dashboard view (yet): selected alone, they stay
 * on "Alle" rather than navigating to a tab that does not exist.
 */
const NO_OWN_VIEW = new Set<FilterDomainKey>(["bus", "rental"]);
type ViewKey = Exclude<FilterDomainKey, "bus" | "rental">;
const hasOwnView = (key: FilterDomainKey): key is ViewKey => !NO_OWN_VIEW.has(key);

/**
 * Drives the "Alle" tab's domain-filter button/panel: which of the six rows
 * this reader may even see, their live counts, and the hidden/visible state
 * — the reader's own persisted choice, or a shared link's choice while one is
 * in view (decision 3).
 *
 * `tourCount` is a parameter rather than fetched here because the caller
 * (`AllTab.tsx`) already holds the tour/roadtrip list from
 * `useDashboardTours` for the map layers — fetching it a second time here
 * would be the exact N+1 `useDashboardTours`'s own doc comment warns against.
 */
export function useDashboardDomainFilter(tourCount: number | null): DashboardDomainFilterResult {
  const { isEnabled } = useEnabledDomains();
  const toursVisible = useToursVisible();
  const railVisible = useRailVisible();
  const rentalVisible = useRentalVisible();
  const busVisible = useBusVisible();
  const counts = useDashboardCountsStore((s) => s.counts);
  const [search] = useSearchParams();
  const { tab, setTab } = useDashboardRoute();

  const hidden = useDashboardDomainFilterStore((s) => s.hidden);
  const linkHidden = useDashboardDomainFilterStore((s) => s.linkHidden);
  const toggle = useDashboardDomainFilterStore((s) => s.toggle);
  const showAll = useDashboardDomainFilterStore((s) => s.showAll);
  const showNone = useDashboardDomainFilterStore((s) => s.showNone);
  const enterLink = useDashboardDomainFilterStore((s) => s.enterLink);
  const exitLink = useDashboardDomainFilterStore((s) => s.exitLink);
  const adoptLink = useDashboardDomainFilterStore((s) => s.adoptLink);

  const domainsParam = search.get("domains");

  // Enter/exit link mode as the URL's `domains` param appears/disappears.
  // Keyed on the param's own value alone: re-running this whenever `enterLink`
  // is a "new" function (every render, being a Zustand action bound to `set`)
  // would re-enter link mode on every unrelated re-render and silently
  // overwrite edits the reader just made while viewing the link.
  useEffect(() => {
    if (domainsParam === null) {
      exitLink();
      return;
    }
    enterLink(parseDomainsParam(domainsParam) ?? new Set());
  }, [domainsParam]);

  const setVisible = useDashboardDomainFilterStore((s) => s.setVisible);

  /**
   * A single-domain view IS a selection of one — the route and the filter are
   * two readings of the same question ("what do I want to see"), so on
   * `/dashboard/cruise` the rows are DERIVED from the route rather than read
   * from storage. Without this the two could contradict each other: a stored
   * set hiding cruises while the cruise view is on screen.
   *
   * Which is also why "Nur" navigates (below): a domain on its own is the one
   * state in which that domain's own map modes — Hafen-Häufigkeit, Nächte,
   * Trips, the eight views "Alle" has no equivalent for — can be offered at
   * all. `TAB_MODE_REGISTRY` keys them by tab, so the tab has to move.
   */
  const routeDomain = tab !== "all" && isFilterDomainKey(tab) ? tab : null;
  const effectiveHidden = routeDomain
    ? new Set(FILTER_DOMAIN_ORDER.filter((k) => k !== routeDomain))
    : (linkHidden ?? hidden);

  const rows = useMemo<DomainFilterRow[]>(() => {
    const available: Record<FilterDomainKey, boolean> = {
      flight: isEnabled("flight"),
      cruise: isEnabled("cruise"),
      lodging: isEnabled("lodging"),
      poi: isEnabled("poi"),
      tour: toursVisible,
      roadtrip: isEnabled("roadtrip"),
      // Both halves of rail's own gate live in `useRailVisible`: the instance
      // beta switch AND the user's domain.
      rail: railVisible,
      // Bus: the `busDomain` beta switch AND the user's domain (`useBusVisible`).
      bus: busVisible,
      rental: rentalVisible,
    };
    const rowCount: Record<FilterDomainKey, number | null> = {
      flight: counts.flight,
      cruise: counts.cruise,
      lodging: counts.lodging,
      poi: counts.poi,
      tour: tourCount,
      roadtrip: counts.roadtrip,
      rail: counts.rail,
      // Nor bus rides: unknown, not 0.
      bus: null,
      // The dashboard counts carry no rentals; the row says "unknown", not 0.
      rental: null,
    };
    return FILTER_DOMAIN_ORDER.filter((key) => available[key]).map((key) => ({
      key,
      visible: !effectiveHidden.has(key),
      count: rowCount[key],
      beta: BETA_ROWS.has(key),
    }));
  }, [
    isEnabled,
    toursVisible,
    railVisible,
    busVisible,
    rentalVisible,
    counts,
    tourCount,
    effectiveHidden,
  ]);

  const visibleCount = rows.filter((r) => r.visible).length;
  const totalCount = rows.length;

  /**
   * The selection decides the route: exactly one domain means that domain's
   * own view, anything else means "Alle". Every action below goes through
   * here, so the two can never disagree.
   */
  const applyVisible = (next: ReadonlySet<FilterDomainKey>): void => {
    const visible = rows.map((r) => r.key).filter((k) => next.has(k));
    // One domain: its own view. The stored set is deliberately NOT written —
    // it belongs to "Alle", and a reader who goes Back should find the
    // selection they left there, not one this navigation invented.
    // Rental and bus have no dashboard view of their own (yet): alone, they stay on "Alle".
    if (visible.length === 1 && hasOwnView(visible[0])) {
      setTab(visible[0]);
      return;
    }
    setVisible(next);
    if (tab !== "all") setTab("all");
  };

  const visibleNow = new Set(rows.filter((r) => r.visible).map((r) => r.key));

  return {
    rows,
    visibleCount,
    totalCount,
    isEmpty: totalCount > 0 && visibleCount === 0,
    isLinkMode: linkHidden !== null,
    isVisible: (key) => !effectiveHidden.has(key),
    // On "Alle" a tick is plain visibility, as before. On a single-domain view
    // there is no stored set to edit — a tick there means "and this one too",
    // which is two domains, which is "Alle".
    toggle: (key) => {
      if (routeDomain === null) {
        toggle(key);
        return;
      }
      const next = new Set(visibleNow);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      applyVisible(next);
    },
    showAll: () => {
      showAll();
      if (tab !== "all") setTab("all");
    },
    showNone: () => {
      showNone();
      if (tab !== "all") setTab("all");
    },
    // Decision 4's one click, now also the door to that domain's own modes.
    // Leaves the stored "Alle" selection alone, for the same reason
    // `applyVisible` does.
    isolate: (key) => (hasOwnView(key) ? setTab(key) : applyVisible(new Set([key]))),
    adoptLink,
    viewOwnSelection: exitLink,
  };
}

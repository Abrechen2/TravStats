import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useEnabledDomains } from "./useEnabledDomains";
import { useToursVisible } from "./useToursVisible";
import { useDashboardCountsStore } from "../store/dashboardCountsStore";
import { useDashboardDomainFilterStore } from "../store/dashboardDomainFilterStore";
import {
  FILTER_DOMAIN_ORDER,
  parseDomainsParam,
  type FilterDomainKey,
} from "../shared/dashboardDomainFilter";

export interface DomainFilterRow {
  readonly key: FilterDomainKey;
  readonly visible: boolean;
  readonly count: number;
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
 * The two domains still behind the `roadtrips` beta key
 * (`config/betaFeatures.ts`) — the only beta-gated members of the six-row
 * filter. flight/cruise/lodging/poi carry no beta entry at all, and `rail`
 * (its own `railDomain` key) is outside this filter's scope entirely (see
 * `shared/dashboardDomainFilter.ts`). A row only reaches `rows` once its own
 * gate is open, so this flag is purely informational — "still labelled beta
 * on this instance", not a second gate.
 */
const BETA_ROWS = new Set<FilterDomainKey>(["tour", "roadtrip"]);

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
export function useDashboardDomainFilter(tourCount: number): DashboardDomainFilterResult {
  const { isEnabled } = useEnabledDomains();
  const toursVisible = useToursVisible();
  const counts = useDashboardCountsStore((s) => s.counts);
  const [search] = useSearchParams();

  const hidden = useDashboardDomainFilterStore((s) => s.hidden);
  const linkHidden = useDashboardDomainFilterStore((s) => s.linkHidden);
  const toggle = useDashboardDomainFilterStore((s) => s.toggle);
  const showAll = useDashboardDomainFilterStore((s) => s.showAll);
  const showNone = useDashboardDomainFilterStore((s) => s.showNone);
  const isolate = useDashboardDomainFilterStore((s) => s.isolate);
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

  const effectiveHidden = linkHidden ?? hidden;

  const rows = useMemo<DomainFilterRow[]>(() => {
    const available: Record<FilterDomainKey, boolean> = {
      flight: isEnabled("flight"),
      cruise: isEnabled("cruise"),
      lodging: isEnabled("lodging"),
      poi: isEnabled("poi"),
      tour: toursVisible,
      roadtrip: isEnabled("roadtrip"),
    };
    const rowCount: Record<FilterDomainKey, number> = {
      flight: counts.flight,
      cruise: counts.cruise,
      lodging: counts.lodging,
      poi: counts.poi,
      tour: tourCount,
      roadtrip: counts.roadtrip,
    };
    return FILTER_DOMAIN_ORDER.filter((key) => available[key]).map((key) => ({
      key,
      visible: !effectiveHidden.has(key),
      count: rowCount[key],
      beta: BETA_ROWS.has(key),
    }));
  }, [isEnabled, toursVisible, counts, tourCount, effectiveHidden]);

  const visibleCount = rows.filter((r) => r.visible).length;
  const totalCount = rows.length;

  return {
    rows,
    visibleCount,
    totalCount,
    isEmpty: totalCount > 0 && visibleCount === 0,
    isLinkMode: linkHidden !== null,
    isVisible: (key) => !effectiveHidden.has(key),
    toggle,
    showAll,
    showNone,
    isolate,
    adoptLink,
    viewOwnSelection: exitLink,
  };
}

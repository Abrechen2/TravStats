import { useMemo } from "react";
import {
  useDashboardDomainFilter,
  type DashboardDomainFilterResult,
} from "../../../hooks/useDashboardDomainFilter";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../../hooks/usePlacesVisible";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import type { TourSummary } from "../../../lib/api/tourIndex";

export interface AllTabDomainVisibility {
  domainFilter: DashboardDomainFilterResult;
  /** Day-tour count (roadtrips excluded) — the filter row's own count. */
  dayTourCount: number;
  /** One flag per real (non-"all") domain this file draws on the map. */
  visible: {
    flight: boolean;
    cruise: boolean;
    lodging: boolean;
    poi: boolean;
    roadtrip: boolean;
    tour: boolean;
  };
}

/**
 * `AllTab`'s per-domain visibility — the AND of every gate that can hide a
 * domain there: the pre-existing map-options sidebar pill
 * (`filterDomains`/`isEnabled`), and, since 2026-09-27, the new domain-filter
 * button's own six rows (`useDashboardDomainFilter`). Extracted out of
 * `AllTab.tsx` purely to keep that file under the file-size ratchet — none of
 * this logic is reused elsewhere.
 *
 * Reads `isEnabled`/`filterDomains`/`placesAllowed` itself rather than taking
 * them as parameters — `AllTab` already subscribes to the same three stores
 * for its own (unrelated) purposes, and a second subscription is an ordinary,
 * cheap Zustand/context read, not a second fetch. `tours` is the one
 * parameter this hook DOES take, because it backs `useDashboardTours`, a real
 * network call `AllTab` must only make once (see that hook's own doc comment
 * on the N+1 it exists to prevent).
 */
export function useAllTabDomainVisibility(tours: readonly TourSummary[]): AllTabDomainVisibility {
  const { isEnabled } = useEnabledDomains();
  const filterDomains = useDashboardFilterStore((s) => s.domains);
  const placesAllowed = usePlacesVisible();

  const dayTourCount = useMemo(
    () => tours.filter((tour) => tour.kind !== "roadtrip").length,
    [tours]
  );
  const domainFilter = useDashboardDomainFilter(dayTourCount);

  const has = (key: "flight" | "cruise" | "lodging" | "roadtrip"): boolean =>
    filterDomains.includes(key) && isEnabled(key) && domainFilter.isVisible(key);

  return {
    domainFilter,
    dayTourCount,
    visible: {
      flight: has("flight"),
      cruise: has("cruise"),
      lodging: has("lodging"),
      poi: filterDomains.includes("poi") && placesAllowed && domainFilter.isVisible("poi"),
      // A roadtrip IS a domain: it answers to the user's own switch and the
      // filter pill like a cruise does. A day tour is not a domain and has
      // no pill — only the new filter's own row.
      roadtrip: has("roadtrip"),
      tour: domainFilter.isVisible("tour"),
    },
  };
}

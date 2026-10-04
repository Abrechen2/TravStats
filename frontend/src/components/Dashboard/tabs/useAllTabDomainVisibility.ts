import { useMemo } from "react";
import {
  useDashboardDomainFilter,
  type DashboardDomainFilterResult,
} from "../../../hooks/useDashboardDomainFilter";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../../hooks/usePlacesVisible";
import type { TourSummary } from "../../../lib/api/tourIndex";
import type { AppearanceDomain } from "../../map/controlPanelKit";

const MAP_DRAWN_DOMAINS: readonly AppearanceDomain[] = ["flight", "cruise", "lodging", "poi"];
const OVERLAY_DOMAINS: readonly AppearanceDomain[] = [
  ...MAP_DRAWN_DOMAINS,
  "tour",
  "roadtrip",
  "rail",
  "rental",
];

/**
 * Which appearance sections the overview map's panel offers. Tours, roadtrips,
 * rail and rentals are drawn there only while `showTours` holds (the roadtrip
 * beta switch, and not the journey view), so their sections follow the same
 * condition — a slider for a layer the map does not draw is the bug forgejo#198
 * must not swap for another. Each section also checks its own domain gate
 * (`OverlayAppearanceSections`). No roadtrip-station slider: this map does not
 * draw the stations.
 */
export function allTabAppearanceDomains(showTours: boolean): readonly AppearanceDomain[] {
  return showTours ? OVERLAY_DOMAINS : MAP_DRAWN_DOMAINS;
}

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
 * `AllTab`'s per-domain visibility — the AND of the two gates that remain:
 * whether the user has the domain at all (`isEnabled`/`placesAllowed`), and
 * the domain filter's own six rows (`useDashboardDomainFilter`).
 *
 * There used to be a third: the map-options sidebar's domain pills
 * (`dashboardFilterStore.domains`). They went on 2026-09-28 together with
 * their stored set, because two controls answering "is this domain on the
 * map" could contradict each other, and the pills were the half nobody could
 * see from the filter. Removing the buttons alone would have been worse than
 * leaving them: a domain deselected there would have stayed hidden with no
 * control left to restore it.
 *
 * Reads `isEnabled`/`placesAllowed` itself rather than taking them as
 * parameters — `AllTab` already subscribes to the same stores for its own
 * (unrelated) purposes, and a second subscription is an ordinary, cheap read,
 * not a second fetch. `tours` is the one parameter this hook DOES take,
 * because it backs `useDashboardTours`, a real network call `AllTab` must
 * only make once (see that hook's doc comment on the N+1 it prevents).
 */
export function useAllTabDomainVisibility(tours: readonly TourSummary[]): AllTabDomainVisibility {
  const { isEnabled } = useEnabledDomains();
  const placesAllowed = usePlacesVisible();

  const dayTourCount = useMemo(
    () => tours.filter((tour) => tour.kind !== "roadtrip").length,
    [tours]
  );
  const domainFilter = useDashboardDomainFilter(dayTourCount);

  const has = (key: "flight" | "cruise" | "lodging" | "roadtrip"): boolean =>
    isEnabled(key) && domainFilter.isVisible(key);

  return {
    domainFilter,
    dayTourCount,
    visible: {
      flight: has("flight"),
      cruise: has("cruise"),
      lodging: has("lodging"),
      poi: placesAllowed && domainFilter.isVisible("poi"),
      // A roadtrip IS a domain: it answers to the user's own switch like a
      // cruise does. A day tour is not a domain, so it has only the filter row.
      roadtrip: has("roadtrip"),
      tour: domainFilter.isVisible("tour"),
    },
  };
}

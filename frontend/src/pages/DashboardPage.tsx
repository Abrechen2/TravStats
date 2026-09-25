import { useEffect, useState } from "react";
import { useToursAccess } from "../hooks/useToursVisible";
import { Navigate } from "react-router-dom";
import type { JSX } from "react";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";
import { useDashboardRoute } from "../hooks/useDashboardRoute";
import { useClearMapSelectionsOnTabChange } from "../hooks/useClearMapSelectionsOnTabChange";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { usePlacesAccess, usePlacesVisible } from "../hooks/usePlacesVisible";
import { flightsApi } from "../lib/api/flights";
import { cruiseApi } from "../lib/api/cruise";
import { getLodgingStats } from "../lib/api/lodging";
import { placesApi } from "../lib/api/places";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../store/toastStore";
import { useDashboardCountsStore } from "../store/dashboardCountsStore";
import { AllTab } from "../components/Dashboard/tabs/AllTab";
import { FlightsTab } from "../components/Dashboard/tabs/FlightsTab";
import { CruisesTab } from "../components/Dashboard/tabs/CruisesTab";
import { PoiTab } from "../components/Dashboard/tabs/PoiTab";
import { LodgingTab } from "../components/Dashboard/tabs/LodgingTab";
import { TourTab } from "../components/Dashboard/tabs/TourTab";
import { roadtripsApi } from "../lib/api/roadtrips";

const IMPORT_MOVED_FLAG = "tsv1_5_import_moved_seen";

/**
 * One-time info toast telling EXISTING users that the import feature has moved
 * to Settings → Import. Suppressed via a localStorage flag after first display.
 *
 * `enabled` gates it on the account actually having flights: the copy says
 * import is "jetzt hier", which only makes sense to someone who knew where it
 * used to be. On a fresh install nobody does (#237) — there the empty-state
 * card points at import directly instead.
 */
function useImportMigrationToast(enabled: boolean): void {
  const { t } = useTranslation(["settings"]);
  const addToast = useToastStore((s) => s.addToast);
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(IMPORT_MOVED_FLAG)) return;
    addToast(
      "info",
      t("settings:import.toast.movedFromDashboard") ||
        "The flight import has moved to Settings → Import.",
      8000
    );
    window.localStorage.setItem(IMPORT_MOVED_FLAG, "1");
  }, [enabled, addToast, t]);
}

export default function DashboardPage(): JSX.Element {
  const { tab } = useDashboardRoute();
  // #257: a selected flight/cruise (popup + rings) must not survive into
  // another domain's map.
  useClearMapSelectionsOnTabChange(tab);
  const { isEnabled } = useEnabledDomains();
  const placesVisible = usePlacesVisible();
  const placesAccess = usePlacesAccess();
  const toursAccess = useToursAccess();
  // Tours have no domain to be "enabled"/"disabled" — only the instance-level
  // beta flag gates them. `betaFeaturesEnabled` is `null` for one request on
  // a cold load; treating that as "denied" would redirect a direct
  // `/dashboard/tour` load away before the flag has even answered, the exact
  // /dashboard/poi bug below.
  // Counts live in a module-level Zustand store, not `useState` here --
  // `App.tsx` keys its animated `Routes` on `location.pathname`, so
  // `/dashboard/flight` -> `/dashboard/cruise` remounts this component on
  // every tab change. A local `useState` would reset to zero and refetch on
  // each switch; `DomainTabStrip` shows the badge for any non-null count, so
  // the strip flashed "0" on every tab change (tester report, task 2 of the
  // 2026-09-17 alex-design-feedback plan). The store survives the remount:
  // the effect below still refetches for freshness, but the badge keeps
  // showing the last loaded number while that refetch is in flight.
  const { counts, scheduledCounts, countsLoaded, setCounts } = useDashboardCountsStore();
  // Only nag about the moved import once the account is known to have flights.
  useImportMigrationToast(countsLoaded && counts.flight > 0);
  // Bumping this token re-runs the counts effect AND remounts the
  // active tab (via key prop) so per-tab data picks up the new entry
  // without needing a separate refetch wiring per tab.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const flightsPromise = flightsApi.getAll({ limit: 1, offset: 0 });
        const scheduledFlightsPromise = flightsApi.getAll({
          limit: 1,
          offset: 0,
          status: "scheduled",
        });
        const cruisesPromise = isEnabled("cruise") ? cruiseApi.list({}) : Promise.resolve([]);
        // getLodgingStats().lodgingsCount is the exact count — cheaper than
        // fetching the full lodging list just to read its length.
        const lodgingPromise = isEnabled("lodging") ? getLodgingStats() : Promise.resolve(null);
        // `visited: true` so the tab count matches "Orte besucht" on the tab
        // itself. Counting wishlist entries here would make the strip disagree
        // with every figure inside the tab (shared/placeCounting.ts).
        // Roadtrips (2.7): the list is small and carries its own figures, so
        // its length is the count — there is no cheaper endpoint to ask.
        const roadtripsPromise = isEnabled("roadtrip")
          ? roadtripsApi.list().then((r) => r.length)
          : Promise.resolve(0);
        const placesPromise = placesVisible
          ? placesApi.count({ visited: true })
          : Promise.resolve(0);
        const [flights, scheduledFlights, cruises, lodgingStats, placeCount, roadtripCount] =
          await Promise.all([
            flightsPromise,
            scheduledFlightsPromise,
            cruisesPromise,
            lodgingPromise,
            placesPromise,
            roadtripsPromise,
          ]);
        if (cancelled) return;
        setCounts(
          {
            flight: flights.total,
            cruise: cruises.length,
            poi: placeCount,
            lodging: lodgingStats?.lodgingsCount ?? 0,
            roadtrip: roadtripCount,
          },
          {
            flight: scheduledFlights.total,
            cruise: cruises.filter((c) => c.status === "scheduled").length,
            // A house whose every stay still lies ahead. It is NOT part of
            // `counts.lodging` above -- `lodgingsCount` is houses been to --
            // which is why the strip words this one as an addition rather
            // than a subset (tester, 2026-09-21: the strip named the next
            // stay on the right and still said nothing about it on the left).
            lodging: lodgingStats?.plannedLodgingsCount ?? 0,
          }
        );
      } catch (err) {
        logger.error("Failed to load dashboard counts:", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isEnabled, placesVisible, refreshToken]);

  // `/dashboard/poi` on a hidden instance used to render the SHELL with the
  // tab hidden from the strip — which still drew the shell's per-tab
  // "+ POI hinzufügen" button over an empty page, because that button follows
  // `tab` and never asked whether the tab is visible. Suppressing the tab body
  // alone was not enough. Same answer the /places route already gives, and
  // three-state for the same reason: the beta flag is `null` for one request
  // on a cold load, and treating that as "no" is what made /places bounce on
  // every refresh (defect 1 in the branch's own handover).
  if (tab === "poi" && placesAccess === "denied") {
    return <Navigate to="/dashboard" replace />;
  }
  // Same for the tour and roadtrip tabs behind the roadtrips beta key.
  if ((tab === "tour" || tab === "roadtrip") && toursAccess === "denied") {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <DashboardLayout
      counts={counts}
      scheduledCounts={scheduledCounts}
      countsLoaded={countsLoaded}
      onDataChanged={() => setRefreshToken((n) => n + 1)}
    >
      {tab === "all" && <AllTab key={refreshToken} />}
      {tab === "flight" && <FlightsTab key={refreshToken} />}
      {tab === "cruise" && <CruisesTab key={refreshToken} />}
      {tab === "poi" && placesVisible && <PoiTab key={refreshToken} />}
      {tab === "lodging" && <LodgingTab key={refreshToken} />}
      {tab === "tour" && <TourTab key={refreshToken} />}
      {tab === "roadtrip" && <TourTab key={`roadtrip-${refreshToken}`} kind="roadtrip" />}
    </DashboardLayout>
  );
}

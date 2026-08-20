import { useEffect, useState } from "react";
import type { JSX } from "react";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";
import { useDashboardRoute } from "../hooks/useDashboardRoute";
import { useClearMapSelectionsOnTabChange } from "../hooks/useClearMapSelectionsOnTabChange";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { flightsApi } from "../lib/api/flights";
import { cruiseApi } from "../lib/api/cruise";
import { getLodgingStats } from "../lib/api/lodging";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../store/toastStore";
import { AllTab } from "../components/Dashboard/tabs/AllTab";
import { FlightsTab } from "../components/Dashboard/tabs/FlightsTab";
import { CruisesTab } from "../components/Dashboard/tabs/CruisesTab";
import { PoiTab } from "../components/Dashboard/tabs/PoiTab";
import { LodgingTab } from "../components/Dashboard/tabs/LodgingTab";

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
  const { isFeatureVisible } = useBetaFeatures();
  const [counts, setCounts] = useState({ flight: 0, cruise: 0, poi: 0, lodging: 0 });
  // How many of the counted entries are merely planned (B6): shown as a
  // "(n geplant)" hint so the tab count and the flown-only statistics stop
  // looking contradictory. Cruises derive it from the list already loaded;
  // flights need their own count query.
  const [scheduledCounts, setScheduledCounts] = useState<{ flight: number; cruise: number }>({
    flight: 0,
    cruise: 0,
  });
  const [countsLoaded, setCountsLoaded] = useState(false);
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
        const lodgingPromise = isEnabled("lodging")
          ? getLodgingStats()
          : Promise.resolve(null);
        const [flights, scheduledFlights, cruises, lodgingStats] = await Promise.all([
          flightsPromise,
          scheduledFlightsPromise,
          cruisesPromise,
          lodgingPromise,
        ]);
        if (cancelled) return;
        setCounts({
          flight: flights.total,
          cruise: cruises.length,
          poi: 0,
          lodging: lodgingStats?.lodgingsCount ?? 0,
        });
        setScheduledCounts({
          flight: scheduledFlights.total,
          cruise: cruises.filter((c) => c.status === "scheduled").length,
        });
        setCountsLoaded(true);
      } catch (err) {
        logger.error("Failed to load dashboard counts:", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isEnabled, refreshToken]);

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
      {/* POI is a placeholder panel — hidden with its tab-bar entry behind the
          beta gate, so /dashboard/poi renders nothing on a gated instance. */}
      {tab === "poi" && isFeatureVisible("poiDashboardTab") && <PoiTab key={refreshToken} />}
      {tab === "lodging" && <LodgingTab key={refreshToken} />}
    </DashboardLayout>
  );
}

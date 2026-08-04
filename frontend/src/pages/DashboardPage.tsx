import { useEffect, useState } from "react";
import type { JSX } from "react";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";
import { useDashboardRoute } from "../hooks/useDashboardRoute";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { flightsApi } from "../lib/api/flights";
import { cruiseApi } from "../lib/api/cruise";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../store/toastStore";
import { AllTab } from "../components/Dashboard/tabs/AllTab";
import { FlightsTab } from "../components/Dashboard/tabs/FlightsTab";
import { CruisesTab } from "../components/Dashboard/tabs/CruisesTab";
import { PoiTab } from "../components/Dashboard/tabs/PoiTab";

const IMPORT_MOVED_FLAG = "tsv1_5_import_moved_seen";

/**
 * One-time info toast telling users that the import feature has moved to
 * Settings → Import. Suppressed via a localStorage flag after first display.
 */
function useImportMigrationToast(): void {
  const { t } = useTranslation(["settings"]);
  const addToast = useToastStore((s) => s.addToast);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(IMPORT_MOVED_FLAG)) return;
    addToast(
      "info",
      t("settings:import.toast.movedFromDashboard") ||
        "The flight import has moved to Settings → Import.",
      8000
    );
    window.localStorage.setItem(IMPORT_MOVED_FLAG, "1");
  }, [addToast, t]);
}

export default function DashboardPage(): JSX.Element {
  useImportMigrationToast();
  const { tab } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();
  const [counts, setCounts] = useState({ flight: 0, cruise: 0, poi: 0 });
  // Bumping this token re-runs the counts effect AND remounts the
  // active tab (via key prop) so per-tab data picks up the new entry
  // without needing a separate refetch wiring per tab.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const flightsPromise = flightsApi.getAll({ limit: 1, offset: 0 });
        const cruisesPromise = isEnabled("cruise") ? cruiseApi.list({}) : Promise.resolve([]);
        const [flights, cruises] = await Promise.all([flightsPromise, cruisesPromise]);
        if (cancelled) return;
        setCounts({
          flight: flights.total,
          cruise: cruises.length,
          poi: 0,
        });
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
    <DashboardLayout counts={counts} onDataChanged={() => setRefreshToken((n) => n + 1)}>
      {tab === "all" && <AllTab key={refreshToken} />}
      {tab === "flight" && <FlightsTab key={refreshToken} />}
      {tab === "cruise" && <CruisesTab key={refreshToken} />}
      {/* POI is a placeholder panel — hidden with its tab-bar entry behind the
          beta gate, so /dashboard/poi renders nothing on a gated instance. */}
      {tab === "poi" && isFeatureVisible("poiDashboardTab") && <PoiTab key={refreshToken} />}
    </DashboardLayout>
  );
}

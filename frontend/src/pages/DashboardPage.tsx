import { useEffect, useState } from "react";
import type { JSX } from "react";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";
import { useDashboardRoute } from "../hooks/useDashboardRoute";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { flightsApi } from "../lib/api/flights";
import { cruiseApi } from "../lib/api/cruise";
import { logger } from "../lib/logger";
import { prefetchGlobeTextures } from "../lib/prefetchGlobeTextures";
import { AllTab } from "../components/Dashboard/tabs/AllTab";
import { FlightsTab } from "../components/Dashboard/tabs/FlightsTab";
import { CruisesTab } from "../components/Dashboard/tabs/CruisesTab";
import { PoiTab } from "../components/Dashboard/tabs/PoiTab";

export default function DashboardPage(): JSX.Element {
  const { tab } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const [counts, setCounts] = useState({ flight: 0, cruise: 0, poi: 0 });
  // Bumping this token re-runs the counts effect AND remounts the
  // active tab (via key prop) so per-tab data picks up the new entry
  // without needing a separate refetch wiring per tab.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    prefetchGlobeTextures();
  }, []);

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
      {tab === "poi" && <PoiTab key={refreshToken} />}
    </DashboardLayout>
  );
}

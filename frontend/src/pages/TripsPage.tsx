import { useEffect, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi, type TripCostSuperlative } from "../lib/api";
import { logger } from "../lib/logger";
import type { Trip } from "../types";
import TripsTab from "../components/Trips/TripsTab";
import { TripInsightsBar } from "../components/Trips/TripInsightsBar";
import AppShell from "../components/ui/AppShell";

/**
 * Top-level Trips page (Phase-1 redesign). Was previously embedded as a
 * sub-tab in `FlightsTablePage`; now it owns its own URL (`/trips`) so a
 * trip is a first-class destination, not a flight-side label.
 *
 * The list, its header actions and filters live in `TripsTab`; the page
 * loads the trips and hands over the title and the insights strip.
 */
export default function TripsPage(): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [mostExpensiveTrip, setMostExpensiveTrip] = useState<TripCostSuperlative | null>(null);

  // `getAllWithInsights`, not `getAll` — this is the ONE screen that shows
  // the cross-trip cost superlative, and it must come from the backend's
  // uncapped ranking (evidence spec "The most expensive trip"), never
  // recomputed from this page's own (capped) `trips` array.
  const loadTrips = async (): Promise<void> => {
    try {
      const data = await tripsApi.getAllWithInsights();
      setTrips(data.trips);
      setMostExpensiveTrip(data.mostExpensiveTrip);
    } catch (err) {
      logger.warn("Failed to load trips", err);
    }
  };

  useEffect(() => {
    void loadTrips();
  }, []);

  return (
    <AppShell width="list">
      <TripsTab
        trips={trips}
        onTripsChange={() => void loadTrips()}
        header={{ title: t("trips:tab"), meta: t("trips:count", { count: trips.length }) }}
        insights={<TripInsightsBar trips={trips} mostExpensiveTrip={mostExpensiveTrip} />}
      />
    </AppShell>
  );
}

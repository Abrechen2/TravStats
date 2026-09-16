import { useEffect, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi } from "../lib/api";
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

  const loadTrips = async (): Promise<void> => {
    try {
      const data = await tripsApi.getAll();
      setTrips(data);
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
        insights={<TripInsightsBar trips={trips} />}
      />
    </AppShell>
  );
}

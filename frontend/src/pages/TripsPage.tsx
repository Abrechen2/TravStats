import { useEffect, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi } from "../lib/api";
import { logger } from "../lib/logger";
import type { Trip } from "../types";
import TripsTab from "../components/Trips/TripsTab";
import { TripInsightsBar } from "../components/Trips/TripInsightsBar";
import PageTransition from "../components/PageTransition";
import NavigationBar from "../components/NavigationBar";

/**
 * Top-level Trips page (Phase-1 redesign). Was previously embedded as a
 * sub-tab in `FlightsTablePage`; now it owns its own URL (`/trips`) so a
 * trip is a first-class destination, not a flight-side label.
 *
 * The actual list rendering still lives in `TripsTab` so the migration
 * stays small. A later iteration will replace it with the redesign mockup
 * (richer cards, status filter, multi-domain stats).
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
    <PageTransition>
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <NavigationBar />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-display font-bold mb-1">{t("trips:tab")}</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("trips:count", { count: trips.length })}
          </p>
        </div>
        <TripInsightsBar trips={trips} />
        <TripsTab trips={trips} onTripsChange={() => void loadTrips()} />
      </div>
    </PageTransition>
  );
}

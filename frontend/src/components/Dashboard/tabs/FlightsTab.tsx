import { useEffect, useState, useCallback, useMemo } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { flightsApi } from "../../../lib/api/flights";
import { logger } from "../../../lib/logger";
import type { GeoJSONFeature } from "../../../types";
import type { FlightMode } from "../../../types/dashboard";
import MapContainer3D, { type MapMode } from "../../MapContainer3D";
import { buildStatsMapLayer } from "../modes/buildStatsMapLayer";

// Maps the dashboard-level FlightMode to what MapContainer3D's visMode prop expects.
// "stats-map" is delivered via extraLayers — the map itself renders in "routes" mode.
const FLIGHT_MODE_TO_MAP_MODE: Record<FlightMode, MapMode> = {
  routes: "routes",
  heatmap: "heatmap",
  "stats-map": "routes",
  trips: "trips",
};

// Reverse-maps MapMode back to the closest FlightMode so the VisModeSelector
// inside MapContainer3D can keep the URL in sync when the user changes mode
// from within the map controls.
const MAP_MODE_TO_FLIGHT_MODE: Partial<Record<MapMode, FlightMode>> = {
  routes: "routes",
  heatmap: "heatmap",
  trips: "trips",
};

export function FlightsTab(): JSX.Element {
  const { mode, setMode } = useDashboardRoute();
  const [flights, setFlights] = useState<GeoJSONFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    flightsApi
      .getGeoJSON()
      .then((collection) => {
        if (!cancelled) setFlights(collection.features);
      })
      .catch((err: unknown) => {
        logger.error("FlightsTab: failed to load GeoJSON", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Current dashboard mode narrowed to FlightMode; fall back to "routes" if the
  // active mode is from a different tab (shouldn't happen in practice but keeps
  // types sound).
  const flightMode = (mode in FLIGHT_MODE_TO_MAP_MODE ? mode : "routes") as FlightMode;
  const visMode = FLIGHT_MODE_TO_MAP_MODE[flightMode];

  const handleVisModeChange = useCallback(
    (next: MapMode): void => {
      const mapped = MAP_MODE_TO_FLIGHT_MODE[next];
      if (mapped !== undefined) {
        setMode(mapped);
      }
    },
    [setMode]
  );

  // Build airport-frequency markers when stats-map mode is active.
  // Memoised so the ScatterplotLayer instance is stable across re-renders
  // that don't change mode or flight data.
  const statsMapLayers = useMemo<Layer[]>(() => {
    if (flightMode !== "stats-map") return [];
    return [buildStatsMapLayer(flights)];
  }, [flightMode, flights]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={flightMode === "stats-map" ? [] : flights}
        visMode={visMode}
        onVisModeChange={handleVisModeChange}
        extraLayers={statsMapLayers}
        showInternalCruises={false}
      />
    </div>
  );
}

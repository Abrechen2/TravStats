import { useEffect, useState, useCallback } from "react";
import type { JSX } from "react";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { flightsApi } from "../../../lib/api/flights";
import { logger } from "../../../lib/logger";
import type { GeoJSONFeature } from "../../../types";
import type { FlightMode } from "../../../types/dashboard";
import type { VisMode } from "../../../types/visMode";
import MapContainer3D from "../../MapContainer3D";

// Maps the dashboard-level FlightMode to what MapContainer3D's visMode prop expects.
// "stats-map" is delivered in Task 14 via extraLayers — falls back to "routes" for now.
const FLIGHT_MODE_TO_VIS_MODE: Record<FlightMode, VisMode> = {
  routes: "routes",
  heatmap: "heatmap",
  "stats-map": "routes",
  trips: "trips",
};

// Reverse-maps VisMode back to the closest FlightMode so the VisModeSelector
// inside MapContainer3D can keep the URL in sync when the user changes mode
// from within the map controls.
const VIS_MODE_TO_FLIGHT_MODE: Partial<Record<VisMode, FlightMode>> = {
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
  const flightMode = (mode in FLIGHT_MODE_TO_VIS_MODE ? mode : "routes") as FlightMode;
  const visMode = FLIGHT_MODE_TO_VIS_MODE[flightMode];

  const handleVisModeChange = useCallback(
    (next: VisMode): void => {
      const mapped = VIS_MODE_TO_FLIGHT_MODE[next];
      if (mapped !== undefined) {
        setMode(mapped);
      }
    },
    [setMode]
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D flights={flights} visMode={visMode} onVisModeChange={handleVisModeChange} />
    </div>
  );
}

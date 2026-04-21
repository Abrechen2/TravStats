import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { flightsApi } from "../../../lib/api/flights";
import { logger } from "../../../lib/logger";
import type { GeoJSONFeature } from "../../../types";
import type { AllMode } from "../../../types/dashboard";
import { ALL_MODES } from "../../../types/dashboard";
import type { VisMode } from "../../../types/visMode";
import MapContainer3D from "../../MapContainer3D";

// Maps the dashboard-level AllMode to what MapContainer3D's visMode prop expects.
// "journey" delegates to routes until Task 16 lands the real cross-domain
// polyline layer.
const ALL_MODE_TO_VIS_MODE: Record<AllMode, VisMode> = {
  overview: "routes",
  heatmap: "heatmap",
  journey: "routes",
  globe: "globe",
};

// Reverse-maps VisMode back to the closest AllMode so the VisModeSelector
// inside MapContainer3D can keep the URL in sync when the user changes mode
// from within the map controls.
const VIS_MODE_TO_ALL_MODE: Partial<Record<VisMode, AllMode>> = {
  routes: "overview",
  heatmap: "heatmap",
  globe: "globe",
};

function isAllMode(mode: unknown): mode is AllMode {
  return typeof mode === "string" && (ALL_MODES as readonly string[]).includes(mode);
}

export function AllTab(): JSX.Element {
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
        logger.error("AllTab: failed to load GeoJSON", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Current dashboard mode narrowed to AllMode; fall back to "overview" if the
  // active mode is from a different tab (shouldn't happen in practice but keeps
  // types sound).
  const allMode: AllMode = isAllMode(mode) ? mode : "overview";
  const visMode = ALL_MODE_TO_VIS_MODE[allMode];

  const handleVisModeChange = useCallback(
    (next: VisMode): void => {
      const mapped = VIS_MODE_TO_ALL_MODE[next];
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

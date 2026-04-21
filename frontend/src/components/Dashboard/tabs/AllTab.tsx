import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { cruiseApi } from "../../../lib/api/cruise";
import { flightsApi } from "../../../lib/api/flights";
import { logger } from "../../../lib/logger";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { AllMode } from "../../../types/dashboard";
import { ALL_MODES } from "../../../types/dashboard";
import type { VisMode } from "../../../types/visMode";
import MapContainer3D from "../../MapContainer3D";
import { buildJourneyLayers } from "../modes/buildJourneyLayers";
import type { Layer } from "@deck.gl/core";

// Maps the dashboard-level AllMode to what MapContainer3D's visMode prop expects.
// "journey" uses extraLayers with showInternalCruises=false so it has full
// control over which trip is rendered.
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
  const [cruises, setCruises] = useState<Cruise[]>([]);

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

  // Cruises are fetched so journey mode can group them with flights by tripId.
  useEffect(() => {
    let cancelled = false;
    cruiseApi
      .list({})
      .then((list) => {
        if (!cancelled) setCruises(list);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load cruises", err);
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

  // Journey layers: built only when journey mode is active. Renders the first
  // trip that has both flights and/or cruises sharing a tripId.  When the
  // backend starts exposing tripId on the GeoJSON endpoint the flight arcs will
  // auto-populate; until then only cruise legs appear.
  const journeyLayers = useMemo<Layer[]>(() => {
    if (allMode !== "journey") return [];
    return buildJourneyLayers(flights, cruises, null);
  }, [allMode, flights, cruises]);

  const handleVisModeChange = useCallback(
    (next: VisMode): void => {
      const mapped = VIS_MODE_TO_ALL_MODE[next];
      if (mapped !== undefined) {
        setMode(mapped);
      }
    },
    [setMode]
  );

  // Journey mode takes over the map entirely: it injects its own cross-domain
  // layers and suppresses the internal cruise arcs that MapContainer3D would
  // otherwise render, so only the selected trip is shown.
  if (allMode === "journey") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <MapContainer3D
          flights={[]}
          visMode="routes"
          onVisModeChange={handleVisModeChange}
          extraLayers={journeyLayers}
          showInternalCruises={false}
        />
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D flights={flights} visMode={visMode} onVisModeChange={handleVisModeChange} />
    </div>
  );
}

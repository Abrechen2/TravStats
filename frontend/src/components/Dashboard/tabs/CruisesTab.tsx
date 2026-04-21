import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { cruiseApi } from "../../../lib/api/cruise";
import { logger } from "../../../lib/logger";
import type { Cruise } from "../../../types/cruise";
import MapContainer3D from "../../MapContainer3D";
import { buildPortFrequencyLayer } from "../modes/buildPortFrequencyLayer";

interface ItineraryDot {
  lat: number;
  lon: number;
  label: string;
  cruiseId: string;
}

export function CruisesTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const [cruises, setCruises] = useState<Cruise[]>([]);

  useEffect(() => {
    let cancelled = false;
    cruiseApi
      .list({})
      .then((list) => {
        if (!cancelled) setCruises(list);
      })
      .catch((err: unknown) => {
        logger.error({ err }, "CruisesTab: failed to load cruises");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const itineraryLayers = useMemo<Layer[]>(() => {
    if (mode !== "itinerary") return [];

    const stops: ItineraryDot[] = cruises.flatMap((c) =>
      c.stops
        .filter((s) => !s.isAtSea && s.port !== null)
        .map((s, index) => ({
          lat: s.port!.lat,
          lon: s.port!.lon,
          label: String(index + 1),
          cruiseId: c.id,
        }))
    );

    if (stops.length === 0) return [];

    return [
      new ScatterplotLayer<ItineraryDot>({
        id: "cruise-itinerary-dots",
        data: stops,
        getPosition: (d) => [d.lon, d.lat],
        getFillColor: [34, 211, 238, 220],
        getRadius: 6,
        radiusUnits: "pixels",
        pickable: true,
      }),
      new TextLayer<ItineraryDot>({
        id: "cruise-itinerary-labels",
        data: stops,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.label,
        getColor: [255, 255, 255],
        getSize: 12,
        background: true,
        backgroundPadding: [3, 2],
        getBackgroundColor: [34, 50, 80, 220],
      }),
    ];
  }, [cruises, mode]);

  const portFrequencyLayers = useMemo<Layer[]>(() => {
    if (mode !== "port-frequency") return [];
    return [buildPortFrequencyLayer(cruises)];
  }, [cruises, mode]);

  const extraLayers =
    mode === "itinerary" ? itineraryLayers : mode === "port-frequency" ? portFrequencyLayers : [];

  // In port-frequency mode, suppress the internal cruise arcs so the
  // frequency markers are not obscured by route overlays.
  const showInternalCruises = mode !== "port-frequency";

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={[]}
        visMode="routes"
        onVisModeChange={() => {
          /* cruise tab manages its own mode via useDashboardRoute */
        }}
        extraLayers={extraLayers}
        showInternalCruises={showInternalCruises}
      />
    </div>
  );
}

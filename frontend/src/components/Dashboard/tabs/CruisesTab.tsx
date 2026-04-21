import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { cruiseApi } from "../../../lib/api/cruise";
import { logger } from "../../../lib/logger";
import type { Cruise } from "../../../types/cruise";
import MapContainer3D from "../../MapContainer3D";

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

  // For sea-routes / port-frequency: MapContainer3D renders the cruise arcs
  // internally via showInternalCruises=true (default). The CruisesTab owns
  // the cruise fetch here, so we suppress the internal cruise fetch in
  // MapContainer3D (showInternalCruises=false) and instead pass the
  // already-fetched cruise list via the extraLayers pathway for itinerary
  // mode. For sea-routes and port-frequency (stub until Task 15),
  // MapContainer3D's internal cruise rendering is re-enabled by passing
  // the cruises prop is not needed — the internal fetch does it.
  // HOWEVER: since we manage the fetch here to avoid double-fetching,
  // we still pass showInternalCruises=true so the arcs layer renders the
  // A* geometry. The CruisesTab's own fetch is purely for itinerary dots.
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={[]}
        visMode="routes"
        onVisModeChange={() => {
          /* cruise tab manages its own mode via useDashboardRoute */
        }}
        extraLayers={itineraryLayers}
      />
    </div>
  );
}

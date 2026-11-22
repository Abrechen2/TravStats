import { useMemo } from "react";
import type { Layer } from "@deck.gl/core";
import { useCruiseGeometry } from "../../../hooks/useCruiseGeometry";
import type { CruiseColorConfig } from "../../../lib/cruiseColor";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import { JOURNEY_GLOBE_ALTITUDE_M, buildJourneyLayers } from "./buildJourneyLayers";

interface JourneyLayerInput {
  active: boolean;
  flights: readonly GeoJSONFeature[];
  cruises: readonly Cruise[];
  tripId: string | null;
  colorConfig?: CruiseColorConfig;
  onGlobe: boolean;
}

/**
 * The Reise map's layers for one trip. The chosen trip's cruises get the
 * server's geometry, so a journey draws the river or hand-drawn line, not an
 * arrowed chord (forgejo#435).
 */
export function useJourneyLayers({
  active,
  flights,
  cruises,
  tripId,
  colorConfig,
  onGlobe,
}: JourneyLayerInput): Layer[] {
  const tripCruises = useMemo<Cruise[]>(
    () => (active ? cruises.filter((c) => c.tripId === tripId) : []),
    [active, cruises, tripId]
  );
  const geometry = useCruiseGeometry(tripCruises);
  return useMemo<Layer[]>(() => {
    if (!active) return [];
    return buildJourneyLayers(
      flights,
      cruises,
      tripId,
      colorConfig,
      onGlobe ? JOURNEY_GLOBE_ALTITUDE_M : 0,
      geometry
    );
  }, [active, flights, cruises, tripId, colorConfig, onGlobe, geometry]);
}

import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoJSONFeature } from "../../../types";

export interface AirportStat {
  iata: string;
  name: string;
  lat: number;
  lon: number;
  count: number;
}

type AirportProps = GeoJSONFeature["properties"]["departureAirport"];

/**
 * Aggregate airport usage across a list of flight GeoJSON features.
 * Each feature's departure + arrival airport contributes 1 count to
 * the respective airport bucket. Features whose airport properties
 * lack a valid IATA code, latitude, or longitude are silently skipped.
 */
export function computeAirportStats(flights: readonly GeoJSONFeature[]): AirportStat[] {
  const byIata = new Map<string, AirportStat>();

  const touch = (ap: AirportProps): void => {
    if (
      typeof ap.iata !== "string" ||
      ap.iata === "" ||
      typeof ap.lat !== "number" ||
      typeof ap.lon !== "number"
    ) {
      return;
    }
    const existing = byIata.get(ap.iata);
    if (existing) {
      byIata.set(ap.iata, { ...existing, count: existing.count + 1 });
    } else {
      byIata.set(ap.iata, {
        iata: ap.iata,
        name: ap.name ?? ap.iata,
        lat: ap.lat,
        lon: ap.lon,
        count: 1,
      });
    }
  };

  for (const f of flights) {
    touch(f.properties.departureAirport);
    touch(f.properties.arrivalAirport);
  }

  return Array.from(byIata.values());
}

/**
 * Build a ScatterplotLayer that renders airport markers scaled by visit count.
 * Intended to be passed as `extraLayers` to MapContainer3D when the active
 * FlightMode is "stats-map".
 */
export function buildStatsMapLayer(flights: readonly GeoJSONFeature[]): Layer {
  const stats = computeAirportStats(flights);
  const max = stats.reduce((m, s) => (s.count > m ? s.count : m), 1);

  return new ScatterplotLayer<AirportStat>({
    id: "stats-map-airports",
    data: stats,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: (d) => 3 + 20 * (d.count / max),
    radiusUnits: "pixels",
    getFillColor: [245, 158, 11, 220],
    stroked: true,
    getLineColor: [255, 255, 255, 180],
    getLineWidth: 1,
    lineWidthUnits: "pixels",
    pickable: true,
  });
}

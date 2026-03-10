import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { GeoJSONFeature } from "../../types";

export interface HeatmapDatum {
  position: [number, number];
  weight: number;
}

export function buildHeatmapData(flights: GeoJSONFeature[]): HeatmapDatum[] {
  const weights = new Map<string, HeatmapDatum>();

  for (const f of flights) {
    for (const ap of [f.properties.departureAirport, f.properties.arrivalAirport]) {
      if (!ap.iata || ap.lon == null || ap.lat == null) continue;
      const existing = weights.get(ap.iata);
      weights.set(ap.iata, {
        position: [ap.lon, ap.lat],
        weight: (existing?.weight ?? 0) + 1,
      });
    }
  }

  return [...weights.values()];
}

export function createHeatmapLayer(flights: GeoJSONFeature[]): HeatmapLayer<HeatmapDatum> {
  return new HeatmapLayer<HeatmapDatum>({
    id: "heatmap",
    data: buildHeatmapData(flights) as HeatmapDatum[],
    getPosition: (d) => d.position,
    getWeight: (d) => d.weight,
    radiusPixels: 60,
    intensity: 1,
    threshold: 0.03,
  });
}

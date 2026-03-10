import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { GeoJSONFeature } from "../../types";

export interface HeatmapDatum {
  position: [number, number];
  weight: number;
}

export function buildHeatmapData(flights: GeoJSONFeature[]): HeatmapDatum[] {
  const weights = new Map<string, HeatmapDatum>();

  for (const f of flights) {
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const depCoord = coords[0] as [number, number];
    const arrCoord = coords[coords.length - 1] as [number, number];

    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;

    if (dep.iata) {
      const existing = weights.get(dep.iata);
      weights.set(dep.iata, { position: depCoord, weight: (existing?.weight ?? 0) + 1 });
    }
    if (arr.iata) {
      const existing = weights.get(arr.iata);
      weights.set(arr.iata, { position: arrCoord, weight: (existing?.weight ?? 0) + 1 });
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

import { ColumnLayer } from "@deck.gl/layers";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";

export interface ColumnDatum {
  position: [number, number];
  count: number;
  color: [number, number, number, number];
}

export function buildColumnData(flights: GeoJSONFeature[]): ColumnDatum[] {
  const counts = new Map<string, { position: [number, number]; count: number }>();

  for (const f of flights) {
    for (const ap of [f.properties.departureAirport, f.properties.arrivalAirport]) {
      if (!ap.iata || ap.lon == null || ap.lat == null) continue;
      const existing = counts.get(ap.iata);
      counts.set(ap.iata, {
        position: [ap.lon, ap.lat],
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  const points = [...counts.values()];
  const { q25, q50, q75 } = calcQuantiles(points.length > 0 ? points.map((p) => p.count) : [0]);

  return points.map((p) => ({
    ...p,
    color: [...getHeatmapColor(p.count, q25, q50, q75), 220] as [number, number, number, number],
  }));
}

export function createColumnsLayer(flights: GeoJSONFeature[]): ColumnLayer<ColumnDatum> {
  const data = buildColumnData(flights);
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return new ColumnLayer<ColumnDatum>({
    id: "columns",
    data,
    getPosition: (d) => d.position,
    getElevation: (d) => (d.count / maxCount) * 500000,
    getFillColor: (d) => d.color,
    diskResolution: 12,
    radius: 30000,
    extruded: true,
    pickable: true,
  });
}

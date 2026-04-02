import { ColumnLayer } from "@deck.gl/layers";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";
import type { MapLayerColors } from "../../types/mapTheme";

export interface ColumnDatum {
  position: [number, number];
  count: number;
  color: [number, number, number, number];
}

export function buildColumnData(
  flights: GeoJSONFeature[],
  themeColors?: MapLayerColors
): ColumnDatum[] {
  const counts = new Map<string, { position: [number, number]; count: number }>();

  for (const f of flights) {
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const depCoord = coords[0] as [number, number];
    const arrCoord = coords[coords.length - 1] as [number, number];

    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;

    if (dep.iata) {
      const existing = counts.get(dep.iata);
      counts.set(dep.iata, { position: depCoord, count: (existing?.count ?? 0) + 1 });
    }
    if (arr.iata) {
      const existing = counts.get(arr.iata);
      counts.set(arr.iata, { position: arrCoord, count: (existing?.count ?? 0) + 1 });
    }
  }

  const points = [...counts.values()];
  const { q25, q50, q75 } = calcQuantiles(points.length > 0 ? points.map((p) => p.count) : [0]);

  return points.map((p) => ({
    ...p,
    color: [...getHeatmapColor(p.count, q25, q50, q75, themeColors), 220] as [
      number,
      number,
      number,
      number,
    ],
  }));
}

export function createColumnsLayer(
  flights: GeoJSONFeature[],
  themeColors?: MapLayerColors
): ColumnLayer<ColumnDatum> {
  const data = buildColumnData(flights, themeColors);
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return new ColumnLayer<ColumnDatum>({
    id: "columns",
    data,
    getPosition: (d) => d.position,
    getElevation: (d) => (d.count / maxCount) * 500000,
    getFillColor: (d) => d.color,
    diskResolution: 20,
    radius: 22000,
    extruded: true,
    pickable: true,
  });
}

import { HexagonLayer } from "@deck.gl/aggregation-layers";
import type { GeoJSONFeature } from "../../types";

export interface HexDatum {
  position: [number, number];
}

export function buildHexData(flights: GeoJSONFeature[]): HexDatum[] {
  const points: HexDatum[] = [];
  for (const f of flights) {
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    points.push({ position: coords[0] as [number, number] });
    points.push({ position: coords[coords.length - 1] as [number, number] });
  }
  return points;
}

export function createHexagonLayer(flights: GeoJSONFeature[]): HexagonLayer<HexDatum> {
  return new HexagonLayer<HexDatum>({
    id: "hexagon",
    data: buildHexData(flights),
    getPosition: (d) => d.position,
    radius: 50000,
    elevationScale: 5000,
    extruded: true,
    pickable: true,
    colorRange: [
      [100, 116, 139, 190], // slate-500 — low density
      [99, 102, 241, 200], // indigo-500
      [139, 92, 246, 210], // violet-500
      [232, 160, 69, 215], // brand amber
      [249, 115, 22, 220], // orange-500
      [239, 68, 68, 230], // red-500 — peak density
    ] as [number, number, number, number][],
  });
}

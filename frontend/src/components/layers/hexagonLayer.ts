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
      [16, 185, 129, 200],
      [234, 179, 8, 200],
      [245, 158, 11, 200],
      [239, 68, 68, 200],
      [220, 38, 38, 200],
      [185, 28, 28, 200],
    ] as [number, number, number, number][],
  });
}

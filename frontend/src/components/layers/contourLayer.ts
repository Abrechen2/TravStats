import { ContourLayer } from "@deck.gl/aggregation-layers";
import { buildHeatmapData } from "./heatmapLayer";
import type { HeatmapDatum } from "./heatmapLayer";
import type { GeoJSONFeature } from "../../types";

export function createContourLayer(flights: GeoJSONFeature[]): ContourLayer<HeatmapDatum> {
  return new ContourLayer<HeatmapDatum>({
    id: "contour",
    data: buildHeatmapData(flights) as HeatmapDatum[],
    getPosition: (d) => d.position,
    getWeight: (d) => d.weight,
    cellSize: 80000, // 80 km per grid cell
    contours: [
      { threshold: 1, color: [100, 116, 139, 120], strokeWidth: 1 }, // slate — rare
      { threshold: 4, color: [232, 160, 69, 170], strokeWidth: 2 }, // amber — regular
      { threshold: 10, color: [249, 115, 22, 210], strokeWidth: 3 }, // orange — frequent
      { threshold: 20, color: [239, 68, 68, 240], strokeWidth: 4 }, // red — hotspot
    ],
  });
}

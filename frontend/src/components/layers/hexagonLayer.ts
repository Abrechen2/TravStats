import { HexagonLayer } from "@deck.gl/aggregation-layers";
import type { GeoJSONFeature } from "../../types";
import type { MapLayerColors } from "../../types/mapTheme";
import { MAP_LAYER_COLORS } from "../../types/mapTheme";

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

export function createHexagonLayer(
  flights: GeoJSONFeature[],
  themeColors?: MapLayerColors
): HexagonLayer<HexDatum> {
  return new HexagonLayer<HexDatum>({
    id: "hexagon",
    data: buildHexData(flights),
    getPosition: (d) => d.position,
    radius: 50000,
    elevationScale: 5000,
    extruded: true,
    pickable: true,
    colorRange: (themeColors?.hexRange ?? MAP_LAYER_COLORS.glassmorphism.hexRange) as [
      number,
      number,
      number,
      number,
    ][],
  });
}

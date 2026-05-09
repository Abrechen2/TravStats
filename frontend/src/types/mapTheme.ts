export type MapTheme = "glassmorphism" | "classic";

export interface MapLayerColors {
  low: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
  peak: [number, number, number];
  airportDot: [number, number, number];
  hexRange: [number, number, number, number][];
}

export const MAP_LAYER_COLORS: Record<MapTheme, MapLayerColors> = {
  glassmorphism: {
    low: [100, 116, 139],
    mid: [240, 169, 71],
    high: [249, 115, 22],
    peak: [239, 68, 68],
    airportDot: [240, 169, 71],
    hexRange: [
      [100, 116, 139, 190],
      [240, 169, 71, 200],
      [245, 140, 50, 210],
      [249, 115, 22, 215],
      [239, 68, 68, 220],
      [220, 38, 38, 230],
    ],
  },
  classic: {
    low: [100, 116, 139],
    mid: [240, 169, 71],
    high: [249, 115, 22],
    peak: [239, 68, 68],
    airportDot: [240, 169, 71],
    hexRange: [
      [100, 116, 139, 190],
      [99, 102, 241, 200],
      [139, 92, 246, 210],
      [240, 169, 71, 215],
      [249, 115, 22, 220],
      [239, 68, 68, 230],
    ],
  },
};

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
    mid: [99, 102, 241],
    high: [139, 92, 246],
    peak: [34, 211, 153],
    airportDot: [147, 197, 253],
    hexRange: [
      [100, 116, 139, 190],
      [79, 70, 229, 200],
      [99, 102, 241, 210],
      [139, 92, 246, 215],
      [52, 211, 153, 220],
      [167, 139, 250, 230],
    ],
  },
  classic: {
    low: [100, 116, 139],
    mid: [232, 160, 69],
    high: [249, 115, 22],
    peak: [239, 68, 68],
    airportDot: [232, 160, 69],
    hexRange: [
      [100, 116, 139, 190],
      [99, 102, 241, 200],
      [139, 92, 246, 210],
      [232, 160, 69, 215],
      [249, 115, 22, 220],
      [239, 68, 68, 230],
    ],
  },
};

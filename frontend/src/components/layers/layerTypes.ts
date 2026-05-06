import type { MapLayerColors } from "../../types/mapTheme";

export interface ArcDatum {
  sourcePosition: [number, number];
  targetPosition: [number, number];
  count: number;
  sourceColor: [number, number, number, number];
  targetColor: [number, number, number, number];
  flightIds: string[];
  // Route carries at least one scheduled flight. Drives the soft outer
  // casing layer that haloes the main arc — signal lives on the arc, not
  // as a separate midpoint dot.
  hasUpcoming?: boolean;
  isHistorical?: boolean;
}

export interface PointDatum {
  position: [number, number];
  count: number;
  name: string;
  iata: string;
}

export interface TripDatum {
  path: [number, number][];
  timestamps: number[];
}

export type HeatmapTier = "low" | "medium" | "high" | "critical";

export const HEATMAP_COLORS: Record<HeatmapTier, [number, number, number]> = {
  low: [100, 116, 139], // slate-500
  medium: [232, 160, 69], // amber-400
  high: [249, 115, 22], // orange-500
  critical: [239, 68, 68], // red-500
};

export function getHeatmapColor(
  count: number,
  q25: number,
  q50: number,
  q75: number,
  themeColors?: Pick<MapLayerColors, "low" | "mid" | "high" | "peak">
): [number, number, number] {
  const c = themeColors ?? {
    low: HEATMAP_COLORS.low,
    mid: HEATMAP_COLORS.medium,
    high: HEATMAP_COLORS.high,
    peak: HEATMAP_COLORS.critical,
  };
  if (count <= q25) return c.low;
  if (count <= q50) return c.mid;
  if (count <= q75) return c.high;
  return c.peak;
}

export function calcQuantiles(counts: number[]): { q25: number; q50: number; q75: number } {
  const sorted = [...counts].sort((a, b) => a - b);
  const last = sorted.length - 1;
  return {
    q25: sorted[Math.floor(last * 0.25)] ?? 0,
    q50: sorted[Math.floor(last * 0.5)] ?? 0,
    q75: sorted[Math.floor(last * 0.75)] ?? 0,
  };
}

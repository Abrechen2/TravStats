export interface ArcDatum {
  sourcePosition: [number, number];
  targetPosition: [number, number];
  count: number;
  sourceColor: [number, number, number, number];
  targetColor: [number, number, number, number];
  flightIds: string[];
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
  low: [100, 116, 139], // slate-500 — muted, recedes into map
  medium: [232, 160, 69], // brand amber accent
  high: [249, 115, 22], // orange-500 — warm intensity
  critical: [239, 68, 68], // red-500 — hotspot
};

export function getHeatmapColor(
  count: number,
  q25: number,
  q50: number,
  q75: number
): [number, number, number] {
  if (count <= q25) return HEATMAP_COLORS.low;
  if (count <= q50) return HEATMAP_COLORS.medium;
  if (count <= q75) return HEATMAP_COLORS.high;
  return HEATMAP_COLORS.critical;
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

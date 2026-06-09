// Heatmap quartile palette + threshold maths shared between the globe
// arc layer and the legend chips. Stateless, no closures — safe to
// import anywhere.
//
// Same colour ramp the 2D `routesLayer` uses, so flight-arc colour
// semantics match across map modes.

export const HEAT_RGB = {
  q4: [239, 68, 68] as [number, number, number], // red — hotspot
  q3: [249, 115, 22] as [number, number, number], // orange-500
  q2: [232, 160, 69] as [number, number, number], // brand amber
  q1: [148, 163, 184] as [number, number, number], // slate-400 — muted
};

export const HEAT_HEX = {
  q4: "#ef4444",
  q3: "#f97316",
  q2: "#e8a045",
  q1: "#94a3b8",
};

export interface HeatmapThresholds {
  q25: number;
  q50: number;
  q75: number;
  max: number;
}

export type Quartile = 1 | 2 | 3 | 4;

export const calculateHeatmapThresholds = (counts: number[]): HeatmapThresholds => {
  if (counts.length === 0) return { q25: 1, q50: 2, q75: 3, max: 5 };
  const sorted = [...counts].sort((a, b) => a - b);
  const len = sorted.length;
  const max = sorted[len - 1];
  const min = sorted[0];
  if (max === min) {
    return {
      q25: Math.floor(min * 0.75),
      q50: Math.floor(min * 0.85),
      q75: Math.floor(min * 0.95),
      max,
    };
  }
  const q25 = sorted[Math.floor(len * 0.25)] ?? min;
  let q50 = sorted[Math.floor(len * 0.5)] ?? min + Math.floor((max - min) * 0.33);
  let q75 = sorted[Math.floor(len * 0.75)] ?? min + Math.floor((max - min) * 0.66);
  if (q50 <= q25) q50 = q25 + Math.max(1, Math.floor((max - q25) * 0.4));
  if (q75 <= q50) q75 = q50 + Math.max(1, Math.floor((max - q50) * 0.5));
  return { q25, q50, q75, max };
};

export const getHeatmapColor = (
  count: number,
  t: HeatmapThresholds
): [number, number, number] => {
  if (count > t.q75) return HEAT_RGB.q4;
  if (count > t.q50) return HEAT_RGB.q3;
  if (count > t.q25) return HEAT_RGB.q2;
  return HEAT_RGB.q1;
};

export const getQuartile = (count: number, t: HeatmapThresholds): Quartile => {
  if (count > t.q75) return 4;
  if (count > t.q50) return 3;
  if (count > t.q25) return 2;
  return 1;
};

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
  // Route carries at least one flight whose status is NOT 'scheduled'
  // (i.e. it has actually been flown — flown / cancelled / historical /
  // duplicated). Combined with `hasUpcoming`, this splits arcs into:
  //   - regular (no upcoming): heatmap colour
  //   - pure-scheduled (upcoming, never flown): solid sky-blue
  //   - mixed (upcoming + past-flown): blue-tipped, hardcoded red core
  hasPastFlown?: boolean;
  isHistorical?: boolean;
  // Status-aware split of `count` — flown/historical vs. scheduled. `count`
  // itself keeps its all-statuses meaning (width/frequency-tier/min-route
  // filter semantics are unchanged); these two are additive breakdowns for
  // the hover tooltip so a planned flight is never presented as flown.
  flownCount: number;
  scheduledCount: number;
  /** First-seen departure/arrival identity for this canonical route —
   *  drives the flag/ICAO/name shown in the hover tooltip. */
  departure: { iata?: string; icao?: string; name?: string; city?: string | null; country?: string | null };
  arrival: { iata?: string; icao?: string; name?: string; city?: string | null; country?: string | null };
}

export interface PointDatum {
  position: [number, number];
  count: number;
  name: string;
  iata: string;
  /** ICAO code, when known — drives the ICAO pill in the hover tooltip. */
  icao?: string;
  /** ISO 3166-1 alpha-2 country code — drives the flag in the hover tooltip. */
  country?: string | null;
  /** City the airport serves — shown in the hover tooltip's place line. */
  city?: string | null;
  /** ISO date of the most recent flight touching this airport.
   *  Surfaced in the hover tooltip alongside the visit count. */
  lastVisit?: string;
}

export interface TripDatum {
  path: [number, number][];
  timestamps: number[];
}

export type HeatmapTier = "low" | "medium" | "high" | "critical";

export const HEATMAP_COLORS: Record<HeatmapTier, [number, number, number]> = {
  low: [100, 116, 139], // slate-500
  medium: [240, 169, 71], // amber (brand --accent)
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

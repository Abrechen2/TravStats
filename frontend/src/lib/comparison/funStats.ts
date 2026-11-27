/**
 * Playful figures derived ONLY from a person's signed totals (nothing new leaves the server).
 * Abstention is a result: a figure that cannot be derived is null, never zero — and a total that
 * is itself a lower bound stays marked as one.
 */
import type { LeaderboardRow } from "./types";

/** Equator, km. */
export const EARTH_CIRCUMFERENCE_KM = 40_075;
/** Mean distance Earth–Moon, km. */
export const MOON_DISTANCE_KM = 384_400;
/** "A half year" of nights, for the hotel comparison. */
export const HALF_YEAR_NIGHTS = 182.5;

export interface FunTotals {
  flightKm: number | null;
  flightMinutes: number | null;
  flights: number | null;
  nights: number | null;
}
export interface FunStats {
  /** Laps around the Earth, by plane. */
  earthLaps: number | null;
  /** Share of the way to the Moon, in percent (can pass 100). */
  moonPercent: number | null;
  /** Time in the air, in days. */
  airDays: number | null;
  /** Hotel nights as a multiple of half a year. */
  nightsInHalfYears: number | null;
  /** Mean flight length, km. */
  avgFlightKm: number | null;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && v >= 0;

export function funStats(t: FunTotals): FunStats {
  return {
    earthLaps: isNum(t.flightKm) ? t.flightKm / EARTH_CIRCUMFERENCE_KM : null,
    moonPercent: isNum(t.flightKm) ? (t.flightKm / MOON_DISTANCE_KM) * 100 : null,
    airDays: isNum(t.flightMinutes) ? t.flightMinutes / 60 / 24 : null,
    nightsInHalfYears: isNum(t.nights) ? t.nights / HALF_YEAR_NIGHTS : null,
    // No flights is "no average", not 0 km — an average over nothing does not exist.
    avgFlightKm:
      isNum(t.flightKm) && isNum(t.flights) && t.flights > 0 ? t.flightKm / t.flights : null,
  };
}

/** Totals of one row for a lifetime or year view; a row that did not answer yields all null. */
export function totalsOf(row: LeaderboardRow | undefined, year: number | null): FunTotals {
  const s = row?.status === "ok" && row.snapshot?.year === year ? row.snapshot : null;
  const at = (k: keyof FunTotals): number | null => {
    const v = s?.metrics[k];
    return typeof v === "number" ? v : null;
  };
  return {
    flightKm: at("flightKm"),
    flightMinutes: at("flightMinutes"),
    flights: at("flights"),
    nights: at("nights"),
  };
}

export interface RivalryLine {
  /** i18n key suffix: `rivalry.<metric>`; `ahead` is the person who leads. */
  metric: string;
  ahead: "you" | "them";
  gap: number;
}

/** Metrics worth a rivalry line, as whole units ("3 Länder"). */
export const RIVALRY_METRICS = ["countries", "flights", "nights", "places", "cruises"] as const;

/**
 * The biggest lead, in the metric's own unit, between two like-for-like totals. Only numbers both
 * sides really have: a null on either side drops the metric, a tie has no line.
 */
export function rivalryLines(
  mine: Record<string, number | null | undefined>,
  theirs: Record<string, number | null | undefined>,
  limit = 3
): RivalryLine[] {
  const lines: RivalryLine[] = [];
  for (const metric of RIVALRY_METRICS) {
    const a = mine[metric];
    const b = theirs[metric];
    if (typeof a !== "number" || typeof b !== "number" || a === b) continue;
    lines.push({ metric, ahead: a > b ? "you" : "them", gap: Math.abs(a - b) });
  }
  // Relative size decides the order, so 3 countries outrank 3 nights.
  return lines
    .sort(
      (x, y) =>
        y.gap / Math.max(mine[y.metric] ?? 1, theirs[y.metric] ?? 1, 1) -
        x.gap / Math.max(mine[x.metric] ?? 1, theirs[x.metric] ?? 1, 1)
    )
    .slice(0, limit);
}

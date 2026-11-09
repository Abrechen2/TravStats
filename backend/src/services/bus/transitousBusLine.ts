import { z } from "zod";

import { calculateDistance } from "../../utils/geo";
import logger from "../../utils/logger";
import { fetchRailJson, lookupDeadline } from "../rail/lookup/railHttp";
import {
  TRANSITOUS_BASE_URL,
  fetchTripDetailed,
  type TripMiss,
  type TripResponse,
} from "../rail/lookup/transitous";
import { decodePolyline, lineLengthKm, sliceBetween, type LonLat } from "../rail/railGeometryMath";

/**
 * The real course of a bus line, from Transitous (MOTIS) trip geometry.
 *
 * A coach ride logged with a line name and a departure time is matched to a
 * timetable trip: the line label at the boarding stop, a scheduled departure
 * near the logged one, and a direction check (the alighting terminal must lie
 * AFTER the boarding stop on that trip). The trip's shape is then clipped to
 * the boarding and alighting stops.
 *
 * Every way of not delivering has its own reason (never a silent road line):
 * the caller keeps stored geometry and says why. Transitous terms are those
 * of `rail/lookup/transitous.ts`: User-Agent with contact, ordinary timetable
 * endpoints, cached answers, no retry on 429.
 */

/** Why no timetable line came back. `no_line` = nothing to match on. */
export const BUS_LINE_MISSES = [
  "no_line",
  "no_match",
  "no_shape",
  "rate_limited",
  "timeout",
  "unavailable",
] as const;
export type BusLineMiss = (typeof BUS_LINE_MISSES)[number];

/** Kept under the road routing's own budget so a save stays inside the client's 10 s. */
export const BUS_LINE_BUDGET_MS = 3_500;
/** A coach stop is a kerb, not a station: the stop-times query and the terminal check are generous. */
const STOP_RADIUS_M = 500;
const TERMINAL_MATCH_KM = 0.8;
/** The logged departure may be the actual one; the timetable's can differ by this much. */
const DEPARTURE_TOLERANCE_MS = 15 * 60_000;
const WINDOW_S = 60 * 60;
const MAX_CANDIDATES = 3;
const BUS_MODES = "BUS,COACH";

const stopTimesResponse = z.object({
  stopTimes: z.array(
    z.object({
      place: z.object({ scheduledDeparture: z.string().nullish() }),
      tripId: z.string(),
      tripShortName: z.string().nullish(),
      routeShortName: z.string().nullish(),
      displayName: z.string().nullish(),
    })
  ),
});

export interface BusLineQuery {
  lineName: string | null;
  departureTime: Date | null;
  dep: { lat: number; lon: number };
  arr: { lat: number; lon: number };
}

export type BusLineResult =
  | { ok: true; geometry: LonLat[]; lengthKm: number; tripId: string }
  | { ok: false; miss: BusLineMiss };

const alnum = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "Bus 48", "48" and "N17" name a line by whole token — 4 is not 48. */
export function lineLabelMatches(
  lineName: string,
  labels: ReadonlyArray<string | null | undefined>
): boolean {
  const wanted = new Set([
    alnum(lineName),
    ...lineName
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  ]);
  return labels.some((label) => label && wanted.has(alnum(label)));
}

const missOfFailure = (f: { reason: "failed" | "outOfTime"; status?: number }): BusLineMiss =>
  f.status === 429 ? "rate_limited" : f.reason === "outOfTime" ? "timeout" : "unavailable";

const missOfTrip = (f: TripMiss): BusLineMiss =>
  f.status === 429 ? "rate_limited" : f.miss === "timedOut" ? "timeout" : "unavailable";

interface Clipped {
  geometry: LonLat[];
  lengthKm: number;
}

/** The trip clipped to boarding/alighting, or null when it does not run dep → arr. */
function clipTrip(trip: TripResponse, q: BusLineQuery): Clipped | "no_match" | "no_shape" {
  const stops = trip.legs.flatMap((leg, i) => {
    const all = [leg.from, ...(leg.intermediateStops ?? []), leg.to];
    return i === 0 ? all : all.slice(1);
  });
  const nearest = (p: { lat: number; lon: number }, from: number) => {
    let best = { index: -1, km: Number.POSITIVE_INFINITY };
    for (let i = from; i < stops.length; i++) {
      const km = calculateDistance(stops[i].lat, stops[i].lon, p.lat, p.lon);
      if (km < best.km) best = { index: i, km };
    }
    return best;
  };
  const board = nearest(q.dep, 0);
  if (board.index < 0 || board.km > TERMINAL_MATCH_KM) return "no_match";
  const alight = nearest(q.arr, board.index + 1);
  if (alight.index < 0 || alight.km > TERMINAL_MATCH_KM) return "no_match";

  const full: LonLat[] = [];
  for (const leg of trip.legs) {
    if (!leg.legGeometry?.points) return "no_shape";
    try {
      full.push(...decodePolyline(leg.legGeometry.points, leg.legGeometry.precision));
    } catch (error) {
      logger.warn({
        operation: "bus_transitous_polyline",
        error: error instanceof Error ? error.message : String(error),
      });
      return "no_shape";
    }
  }
  const b = stops[board.index];
  const a = stops[alight.index];
  const clipped = sliceBetween(full, [b.lon, b.lat], [a.lon, a.lat]);
  if (!clipped || clipped.length < 2) return "no_shape";
  return { geometry: clipped, lengthKm: lineLengthKm(clipped) };
}

/** Never throws; a failure is a `miss` the caller reports and survives. */
export async function lookupBusLine(query: BusLineQuery): Promise<BusLineResult> {
  const line = query.lineName?.trim();
  if (!line || !query.departureTime) return { ok: false, miss: "no_line" };
  try {
    const deadline = lookupDeadline(BUS_LINE_BUDGET_MS);
    const from = new Date(query.departureTime.getTime() - WINDOW_S * 500);
    const url =
      `${TRANSITOUS_BASE_URL}/api/v6/stoptimes?center=${query.dep.lat},${query.dep.lon}` +
      `&radius=${STOP_RADIUS_M}&time=${encodeURIComponent(from.toISOString())}&window=${WINDOW_S}` +
      `&n=60&mode=${BUS_MODES}&realtimeMode=OFF&withAlerts=false`;
    const res = await fetchRailJson("transitous", url, stopTimesResponse, deadline);
    if (!res.ok) return { ok: false, miss: missOfFailure(res) };

    const candidates = res.data.stopTimes
      .filter((st) => {
        const departs = st.place.scheduledDeparture ? new Date(st.place.scheduledDeparture) : null;
        return (
          departs !== null &&
          !Number.isNaN(departs.getTime()) &&
          Math.abs(departs.getTime() - query.departureTime!.getTime()) <= DEPARTURE_TOLERANCE_MS &&
          lineLabelMatches(line, [st.routeShortName, st.displayName, st.tripShortName])
        );
      })
      .slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return { ok: false, miss: "no_match" };

    let worst: BusLineMiss = "no_match";
    for (const candidate of candidates) {
      const trip = await fetchTripDetailed(candidate.tripId, deadline);
      if ("miss" in trip) {
        const miss = missOfTrip(trip);
        // A rate limit or an exhausted budget repeats for the next candidate.
        if (miss === "rate_limited" || miss === "timeout") return { ok: false, miss };
        worst = miss;
        continue;
      }
      const clipped = clipTrip(trip, query);
      if (typeof clipped === "string") {
        if (worst === "no_match") worst = clipped;
        continue;
      }
      return { ok: true, ...clipped, tripId: candidate.tripId };
    }
    return { ok: false, miss: worst };
  } catch (error) {
    logger.warn({
      operation: "bus_transitous_line",
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, miss: "unavailable" };
  }
}

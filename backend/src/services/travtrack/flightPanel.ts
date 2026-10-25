import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { extentOf } from "../../utils/extrema";
import type { StoredPoint } from "../tripRecording/segments";
import { readSafeTravTrack } from "./readSafe";

/**
 * A flight's altitude and speed over time from the account's own TravTrack
 * points linked to it (`travtrack_point_links`, TravTrack plan T5.3, the
 * flight panel). Read through the privacy-safe read (`readSafe.ts`), so the
 * series is cut at every deleted span, reported pause (flight mode among
 * them) and privacy zone, and restricted to the linked points: another
 * device's fix in the same hours is not this flight's, and where one sits
 * between two linked points the series breaks there instead of joining them.
 *
 * Summary figures abstain rather than guess (null, never 0):
 *   - `maxAltitudeM` / `maxSpeedMps` — null without a single recorded value;
 *   - `climbToCruiseMinutes` — from the first shown vertex, when it is near
 *     the ground (≤ 20 % of the highest altitude), to the first vertex at 90 %
 *     of it, both in ONE stretch, and only for a real cruise (≥ 3000 m);
 *     otherwise null — a series starting in the air or broken during the
 *     climb cannot say how long the climb took.
 */

export const FLIGHT_PANEL_POINT_CAP = 20_000;
const CRUISE_MIN_ALTITUDE_M = 3000;
const GROUND_SHARE = 0.2;
const CRUISE_SHARE = 0.9;

/** `[tMs, altitudeM, speedMps]` of one shown vertex. */
export type FlightSample = [number, number | null, number | null];

export type FlightPanel = {
  flightId: string;
  /** Stretches of samples, oldest first; never joined across a cut. */
  series: FlightSample[][];
  pointCount: number;
  /** More linked points than one answer carries; the rest is not shown. */
  truncated: boolean;
  summary: {
    maxAltitudeM: number | null;
    maxSpeedMps: number | null;
    climbToCruiseMinutes: number | null;
  };
};

const maxOf = (values: Array<number | null>): number | null => {
  let best: number | null = null;
  for (const v of values)
    if (v !== null && Number.isFinite(v) && (best === null || v > best)) best = v;
  return best;
};

/** Minutes from a near-ground start to cruise, inside the first stretch only; null when not derivable. */
export function climbToCruiseMinutes(series: readonly FlightSample[][]): number | null {
  const top = maxOf(series.flat().map((s) => s[1]));
  if (top === null || top < CRUISE_MIN_ALTITUDE_M) return null;
  const first = series[0];
  const start = first?.[0];
  if (!start || start[1] === null || start[1] > top * GROUND_SHARE) return null;
  const reached = first.find((s) => s[1] !== null && s[1] >= top * CRUISE_SHARE);
  if (!reached) return null;
  return Math.round(((reached[0] - start[0]) / 60_000) * 10) / 10;
}

const notFound = () => new AppError("No such flight", 404, "TRAVTRACK_FLIGHT_NOT_FOUND");

export async function travTrackFlightPanel(userId: string, flightId: string): Promise<FlightPanel> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: { id: true },
  });
  if (!flight) throw notFound();
  const links = await prisma.travTrackPointLink.findMany({
    where: { userId, entryKind: "flight", entryId: flightId },
    select: { point: { select: { id: true, t: true } } },
  });
  const empty: FlightPanel = {
    flightId,
    series: [],
    pointCount: 0,
    truncated: false,
    summary: { maxAltitudeM: null, maxSpeedMps: null, climbToCruiseMinutes: null },
  };
  const span = extentOf(links.map((l) => l.point.t.getTime()));
  if (!span) return empty;
  const linked = new Set(links.map((l) => l.point.id));
  const read = await readSafeTravTrack(
    userId,
    { fromMs: span.min, untilMs: span.max + 1 },
    FLIGHT_PANEL_POINT_CAP
  );
  const series: FlightSample[][] = [];
  for (const stretch of read.segments) {
    let run: FlightSample[] = [];
    const flush = () => {
      if (run.length > 0) series.push(run);
      run = [];
    };
    for (const p of stretch as StoredPoint[]) {
      const row = read.rowOf(p);
      if (!row || !linked.has(row.id)) {
        flush();
        continue;
      }
      run.push([p[0], row.altitudeM, row.speedMps]);
    }
    flush();
  }
  const samples = series.flat();
  return {
    flightId,
    series,
    pointCount: samples.length,
    truncated: read.next !== null,
    summary: {
      maxAltitudeM: maxOf(samples.map((s) => s[1])),
      maxSpeedMps: maxOf(samples.map((s) => s[2])),
      climbToCruiseMinutes: climbToCruiseMinutes(series),
    },
  };
}

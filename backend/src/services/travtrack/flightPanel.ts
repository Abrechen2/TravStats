import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { FLIGHT_WINDOW_SELECT, flightRecorderWindow } from "../tripRecording/bounds";
import type { StoredPoint } from "../tripRecording/segments";
import { readSafeTravTrack, type SafePointRow } from "./readSafe";

/**
 * A flight's altitude and speed over time from the account's own TravTrack
 * points linked to it (`travtrack_point_links`, TravTrack plan T5.3, the
 * flight panel). Read through the privacy-safe read (`readSafe.ts`), so the
 * series is cut at every deleted span, reported pause (flight mode among
 * them) and privacy zone, and restricted to the linked points: another
 * device's fix in the same hours is not this flight's, and where one sits
 * between two linked points the series breaks there instead of joining them.
 *
 * A flight nothing is linked to — an imported history (the Dawarich copy, GPX,
 * OwnTracks) links nothing, and neither does a phone that was not armed for
 * it — falls back to the fixes inside its recorder window
 * (`flightRecorderWindow`, the window the entry track reads too), and only
 * those of the one source holding most of them there, so two devices in the
 * same hours never zigzag into one profile. `basis` says which of the two the
 * answer is. A flight whose times are a placeholder (date-only) arms no window
 * and stays empty: abstention, not invention.
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

export type FlightPanelBasis = "linked" | "window";

export type FlightPanel = {
  flightId: string;
  /** Where the samples come from: points linked to the flight, or its time window; null when empty. */
  basis: FlightPanelBasis | null;
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

/**
 * Bounded at every step: the linked points' extent is one aggregate, the
 * safe read stops at `cap`, and only the links of the points that read
 * returned are loaded — a recording of a million linked fixes never
 * materialises its links.
 */
export async function travTrackFlightPanel(
  userId: string,
  flightId: string,
  cap: number = FLIGHT_PANEL_POINT_CAP
): Promise<FlightPanel> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: { id: true, ...FLIGHT_WINDOW_SELECT },
  });
  if (!flight) throw notFound();
  const [extent] = await prisma.$queryRaw<{ from_t: Date | null; to_t: Date | null }[]>`
    SELECT min(p.t) AS from_t, max(p.t) AS to_t
      FROM travtrack_point_links l JOIN travtrack_points p ON p.id = l.point_id
     WHERE l.user_id = ${userId} AND l.entry_kind = 'flight' AND l.entry_id = ${flightId}`;
  if (extent?.from_t && extent.to_t) {
    return linkedPanel(userId, flightId, [extent.from_t.getTime(), extent.to_t.getTime()], cap);
  }
  const window = await flightRecorderWindow(flight);
  if (!window) return emptyPanel(flightId);
  return windowPanel(userId, flightId, window, cap);
}

function emptyPanel(flightId: string): FlightPanel {
  return {
    flightId,
    basis: null,
    series: [],
    pointCount: 0,
    truncated: false,
    summary: { maxAltitudeM: null, maxSpeedMps: null, climbToCruiseMinutes: null },
  };
}

type SafeRead = Awaited<ReturnType<typeof readSafeTravTrack>>;

/** The read's stretches, keeping only members; a non-member breaks the stretch. */
function seriesOf(read: SafeRead, member: (row: SafePointRow) => boolean): FlightSample[][] {
  const series: FlightSample[][] = [];
  for (const stretch of read.segments) {
    let run: FlightSample[] = [];
    const flush = () => {
      if (run.length > 0) series.push(run);
      run = [];
    };
    for (const p of stretch as StoredPoint[]) {
      const row = read.rowOf(p);
      if (!row || !member(row)) {
        flush();
        continue;
      }
      run.push([p[0], row.altitudeM, row.speedMps]);
    }
    flush();
  }
  return series;
}

function panelOf(
  flightId: string,
  basis: FlightPanelBasis,
  series: FlightSample[][],
  truncated: boolean
): FlightPanel {
  if (series.length === 0) return { ...emptyPanel(flightId), truncated };
  const samples = series.flat();
  return {
    flightId,
    basis,
    series,
    pointCount: samples.length,
    truncated,
    summary: {
      maxAltitudeM: maxOf(samples.map((s) => s[1])),
      maxSpeedMps: maxOf(samples.map((s) => s[2])),
      climbToCruiseMinutes: climbToCruiseMinutes(series),
    },
  };
}

async function linkedPanel(
  userId: string,
  flightId: string,
  [fromMs, toMs]: [number, number],
  cap: number
): Promise<FlightPanel> {
  const read = await readSafeTravTrack(userId, { fromMs, untilMs: toMs + 1 }, cap);
  const readIds = read.segments.flatMap((stretch) =>
    (stretch as StoredPoint[]).flatMap((p) => {
      const row = read.rowOf(p);
      return row ? [row.id] : [];
    })
  );
  const links =
    readIds.length === 0
      ? []
      : await prisma.travTrackPointLink.findMany({
          where: { userId, entryKind: "flight", entryId: flightId, pointId: { in: readIds } },
          select: { pointId: true },
        });
  const linked = new Set(links.map((l) => l.pointId));
  return panelOf(
    flightId,
    "linked",
    seriesOf(read, (row) => linked.has(row.id)),
    read.next !== null
  );
}

/** A stored point's source: its device, else its origin (an import names no device). */
const sourceOf = (row: SafePointRow): string => row.deviceId ?? row.origin;

/**
 * The source holding most fixes in the WHOLE window, counted in the database
 * before any cap: picking it from a capped read would let the first 20 000
 * fixes outvote the rest. The count only chooses; what is shown still comes
 * from the privacy-safe read.
 */
async function mainSourceIn(
  userId: string,
  [fromMs, toMs]: [number, number]
): Promise<string | null> {
  const [top] = await prisma.$queryRaw<{ source: string }[]>`
    SELECT COALESCE(device_id, origin) AS source
      FROM travtrack_points
     WHERE user_id = ${userId} AND t >= ${new Date(fromMs)} AND t <= ${new Date(toMs)}
     GROUP BY 1
     ORDER BY count(*) DESC, 1
     LIMIT 1`;
  return top?.source ?? null;
}

async function windowPanel(
  userId: string,
  flightId: string,
  window: [number, number],
  cap: number
): Promise<FlightPanel> {
  const main = await mainSourceIn(userId, window);
  if (main === null) return emptyPanel(flightId);
  const read = await readSafeTravTrack(userId, { fromMs: window[0], untilMs: window[1] + 1 }, cap);
  return panelOf(
    flightId,
    "window",
    seriesOf(read, (row) => sourceOf(row) === main),
    read.next !== null
  );
}

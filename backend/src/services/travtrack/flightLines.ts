import { prisma } from "../../db";
import { FLIGHT_WINDOW_SELECT, flightRecorderWindow } from "../tripRecording/bounds";
import { observationOf, TRAVTRACK_OBSERVATION_SELECT } from "../locationProvider/travtrackProvider";
import type { LocationObservation } from "../locationProvider/types";
import { cutFlightTrackWith } from "./flightTrackView";
import { zoneSafeFlightColumns } from "./providerFlightColumns";
import type { CircleSet } from "./privacyCircles";
import { travTrackBreakSet } from "./readSafe";

/**
 * TravTrack lines for the map's flights without an own recording (TravTrack
 * plan T5): each flight's points — linked to it, or inside its recorder window
 * — drawn the way a phone's upload is drawn, broken at every deleted span and
 * reported pause, then privacy-cut.
 *
 * Bounded per flight (final Codex review before the RC): one aggregate picks
 * the flight's main device, and the database thins that device's fixes to at
 * most `FLIGHT_LINE_POINT_CAP`, keeping the first and the last — a map load
 * never materialises a history, and no point is scanned against every window.
 * The line is simplified for the map anyway; thinning only drops vertices, so
 * the privacy cut on the kept ones (vertex AND chord) still holds.
 */

/** The most fixes one flight's map line reads. */
export const FLIGHT_LINE_POINT_CAP = 2_000;

export type TravTrackFlightLine = {
  flightId: string;
  geometry: Array<[number, number]>;
  segmentStarts: number[];
  origin: "travtrack";
};

// The window columns: a date-only or year-only flight arms no window (its
// stored clock is a placeholder), the same precision-aware window everywhere.
const FLIGHT_SELECT = { id: true, ...FLIGHT_WINDOW_SELECT } as const;

type FlightWindow = { flightId: string; fromMs: number; toMs: number | null };

/**
 * The ids of one flight's fixes of its main device, thinned to the cap in the
 * database: members are the fixes linked to the flight or inside its window.
 */
async function thinnedFlightPointIds(userId: string, w: FlightWindow): Promise<bigint[]> {
  const from = new Date(w.fromMs);
  const to = new Date(w.toMs ?? w.fromMs);
  const inWindow = w.toMs !== null;
  const rows = await prisma.$queryRaw<{ seq: bigint }[]>`
    WITH members AS (
      -- Two indexed reads, not one OR: (user_id, t) for the window, the links' index for the rest.
      SELECT p.seq, p.t, p.device_id
        FROM travtrack_points p
       WHERE ${inWindow} AND p.user_id = ${userId} AND p.t >= ${from} AND p.t <= ${to}
      UNION
      SELECT p.seq, p.t, p.device_id
        FROM travtrack_point_links l JOIN travtrack_points p ON p.id = l.point_id
       WHERE l.user_id = ${userId} AND l.entry_kind = 'flight' AND l.entry_id = ${w.flightId}
    ), main AS (
      SELECT device_id FROM members GROUP BY device_id ORDER BY count(*) DESC, device_id LIMIT 1
    ), ranked AS (
      SELECT m.seq, row_number() OVER (ORDER BY m.t, m.seq) AS rn, count(*) OVER () AS n
        FROM members m JOIN main ON m.device_id IS NOT DISTINCT FROM main.device_id
    )
    SELECT seq FROM ranked
     WHERE n <= ${FLIGHT_LINE_POINT_CAP}
        OR rn = n
        OR (rn - 1) % CEIL(n::numeric / ${FLIGHT_LINE_POINT_CAP - 1}) = 0
     ORDER BY rn`;
  return rows.map((r) => r.seq);
}

export async function travTrackFlightLines(
  userId: string,
  circles: CircleSet
): Promise<TravTrackFlightLine[]> {
  const flights = await prisma.flight.findMany({
    where: { userId, track: null, status: { not: "cancelled" } },
    select: FLIGHT_SELECT,
  });
  if (flights.length === 0) return [];
  // The account's TravTrack extent and its flight links, read once: a flight
  // outside the extent with no link holds nothing and costs no query at all
  // (forgejo#333 — it was one thinning query per flight of ten years).
  const [extent, linked] = await Promise.all([
    prisma.travTrackPoint.aggregate({ where: { userId }, _min: { t: true }, _max: { t: true } }),
    prisma.travTrackPointLink.findMany({
      where: { userId, entryKind: "flight" },
      distinct: ["entryId"],
      select: { entryId: true },
      orderBy: { entryId: "asc" },
    }),
  ]);
  const minMs = extent._min.t?.getTime() ?? null;
  const maxMs = extent._max.t?.getTime() ?? null;
  if (minMs === null || maxMs === null) return [];
  const linkedIds = new Set(linked.map((l) => l.entryId));
  // Only flights that hold anything: a window with points, or a link.
  const windows: FlightWindow[] = [];
  for (const f of flights) {
    const w = await flightRecorderWindow(f);
    const hasLink = linkedIds.has(f.id);
    const overlaps = w !== null && w[0] <= maxMs && w[1] >= minMs;
    if (!hasLink && !overlaps) continue;
    windows.push(
      w ? { flightId: f.id, fromMs: w[0], toMs: w[1] } : { flightId: f.id, fromMs: 0, toMs: null }
    );
  }

  const lines: TravTrackFlightLine[] = [];
  for (const w of windows) {
    const seqs = await thinnedFlightPointIds(userId, w);
    if (seqs.length < 2) continue;
    const rows = await prisma.travTrackPoint.findMany({
      where: { userId, seq: { in: seqs } },
      orderBy: [{ t: "asc" }, { seq: "asc" }],
      select: TRAVTRACK_OBSERVATION_SELECT,
    });
    const points: LocationObservation[] = rows.map(observationOf);
    if (points.length < 2) continue;
    const breaksOf = await travTrackBreakSet(userId, {
      fromMs: points[0].atMs,
      untilMs: points[points.length - 1].atMs + 1,
    });
    // Cut on the fixes before they are measured, then once more on the simplified line.
    const columns = zoneSafeFlightColumns(
      points.map((p) => ({ t: p.atMs, lat: p.lat, lon: p.lon })),
      circles(points[0].atMs),
      breaksOf(points[0].deviceId)
    );
    if (!columns) continue;
    const cut = cutFlightTrackWith(columns, circles(columns.startedAt.getTime())).track;
    const geometry = cut.geometry as Array<[number, number]>;
    if (geometry.length < 2) continue;
    lines.push({
      flightId: w.flightId,
      geometry,
      segmentStarts: cut.segmentStarts as number[],
      origin: "travtrack",
    });
  }
  return lines.sort((a, b) => a.flightId.localeCompare(b.flightId));
}

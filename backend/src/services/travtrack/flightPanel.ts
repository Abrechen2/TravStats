import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { getAirportTimezone } from "../../utils/timezone";
import { FLIGHT_WINDOW_SELECT, flightRecorderWindow } from "../tripRecording/bounds";
import type { StoredPoint } from "../tripRecording/segments";
import { DAY_LABEL_DESCRIBERS } from "./dayContextLabels";
import {
  climbToCruiseMinutes,
  downsample,
  landingOf,
  maxOf,
  takeoffOf,
  type FlightSample,
} from "./flightSeries";
import { readSafeTravTrack, type SafeCursor, type SafePointRow } from "./readSafe";

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
 * The whole flight (owner 2026-10-26): the read pages through the safe
 * read's cursor up to FLIGHT_PANEL_READ_CAP points in all, so a long-haul
 * recording is no longer cut at the first page; the answer is then thinned to
 * at most FLIGHT_PANEL_MAX_SAMPLES samples (`flightSeries.ts`), keeping each
 * bucket's apex and top speed, never spanning a break. The summary is taken
 * from every sample read, before the thinning. `truncated` now means only
 * that the read hit its total cap. A page boundary breaks the series like a
 * cut does — two parts of a read are never joined.
 *
 * Summary figures abstain rather than guess (null, never 0):
 *   - `maxAltitudeM` / `maxSpeedMps` — null without a single recorded value;
 *   - `climbToCruiseMinutes` — from the take-off (`takeoffOf`) to the first
 *     sample at 90 % of the highest altitude, in the take-off's stretch, only
 *     for a real cruise (≥ 3000 m); null without a take-off or when the climb
 *     was broken. Never from the window's start: that counted the taxi.
 */

/** Points one page of the safe read takes; also what one links query names. */
export const FLIGHT_PANEL_PAGE = 20_000;
/** Points one panel reads in all, across its pages. */
export const FLIGHT_PANEL_READ_CAP = 300_000;

export type { FlightSample } from "./flightSeries";

export type FlightPanelBasis = "linked" | "window";

export type FlightPanel = {
  flightId: string;
  /** The flight as the day's timeline names it, e.g. "LH718 MUC–ICN". */
  label: string;
  /** The departure airport's zone, for the clock the profile is read in; null when unknown. */
  departureZone: string | null;
  /** Where the samples come from: points linked to the flight, or its time window; null when empty. */
  basis: FlightPanelBasis | null;
  /** Stretches of samples, oldest first, thinned to at most 2000; never joined across a cut. */
  series: FlightSample[][];
  /** The flight's points read (before the thinning). */
  pointCount: number;
  /** The read hit FLIGHT_PANEL_READ_CAP: the rest of the recording is not shown. */
  truncated: boolean;
  takeoffMs: number | null;
  landingMs: number | null;
  summary: {
    maxAltitudeM: number | null;
    maxSpeedMps: number | null;
    climbToCruiseMinutes: number | null;
  };
};

const notFound = () => new AppError("No such flight", 404, "TRAVTRACK_FLIGHT_NOT_FOUND");

type Header = Pick<FlightPanel, "flightId" | "label" | "departureZone">;

/** Points in all, and per page of the safe read (tests make pages small). */
export type ReadLimits = { total: number; page: number };

/**
 * Bounded at every step: the linked points' extent is one aggregate, each
 * page of the safe read takes FLIGHT_PANEL_PAGE points, the pages stop at
 * `cap` in all, and only the links of the points a page returned are loaded
 * — a recording of a million linked fixes never materialises its links.
 */
export async function travTrackFlightPanel(
  userId: string,
  flightId: string,
  limits: number | ReadLimits = FLIGHT_PANEL_READ_CAP
): Promise<FlightPanel> {
  const cap: ReadLimits =
    typeof limits === "number" ? { total: limits, page: FLIGHT_PANEL_PAGE } : limits;
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: { id: true, ...FLIGHT_WINDOW_SELECT },
  });
  if (!flight) throw notFound();
  const described = (await DAY_LABEL_DESCRIBERS.flight(userId, [flightId])).get(flightId);
  const header: Header = {
    flightId,
    label: described?.label ?? "",
    departureZone:
      (await getAirportTimezone(flight.depIata ?? flight.depIcao)) ?? flight.depTimezone ?? null,
  };
  const [extent] = await prisma.$queryRaw<{ from_t: Date | null; to_t: Date | null }[]>`
    SELECT min(p.t) AS from_t, max(p.t) AS to_t
      FROM travtrack_point_links l JOIN travtrack_points p ON p.id = l.point_id
     WHERE l.user_id = ${userId} AND l.entry_kind = 'flight' AND l.entry_id = ${flightId}`;
  if (extent?.from_t && extent.to_t) {
    return linkedPanel(userId, header, [extent.from_t.getTime(), extent.to_t.getTime()], cap);
  }
  const window = await flightRecorderWindow(flight);
  if (!window) return emptyPanel(header);
  return windowPanel(userId, header, window, cap);
}

function emptyPanel(header: Header, truncated = false): FlightPanel {
  return {
    ...header,
    basis: null,
    series: [],
    pointCount: 0,
    truncated,
    takeoffMs: null,
    landingMs: null,
    summary: { maxAltitudeM: null, maxSpeedMps: null, climbToCruiseMinutes: null },
  };
}

type SafeRead = Awaited<ReturnType<typeof readSafeTravTrack>>;

/** One page's stretches, keeping only members; a non-member breaks the stretch. */
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

/**
 * Every page of the window through the safe read's cursor, up to `cap` points
 * in all. `member` decides per page (it may ask the database about that
 * page's points only). A page boundary breaks the series.
 */
async function readPaged(
  userId: string,
  [fromMs, toMs]: [number, number],
  cap: ReadLimits,
  member: (read: SafeRead) => Promise<(row: SafePointRow) => boolean>
): Promise<{ series: FlightSample[][]; truncated: boolean }> {
  const series: FlightSample[][] = [];
  let after: SafeCursor | null = null;
  let left = cap.total;
  for (;;) {
    const page = Math.min(cap.page, left);
    const read = await readSafeTravTrack(userId, { fromMs, untilMs: toMs + 1 }, page, after);
    series.push(...seriesOf(read, await member(read)));
    left -= page;
    if (read.next === null || read.cursor === null) return { series, truncated: false };
    if (left <= 0) return { series, truncated: true };
    after = read.cursor;
  }
}

function panelOf(
  header: Header,
  basis: FlightPanelBasis,
  series: FlightSample[][],
  truncated: boolean
): FlightPanel {
  if (series.length === 0) return emptyPanel(header, truncated);
  const samples = series.flat();
  return {
    ...header,
    basis,
    series: downsample(series),
    pointCount: samples.length,
    truncated,
    takeoffMs: takeoffOf(series)?.tMs ?? null,
    landingMs: landingOf(series),
    summary: {
      maxAltitudeM: maxOf(samples.map((s) => s[1])),
      maxSpeedMps: maxOf(samples.map((s) => s[2])),
      climbToCruiseMinutes: climbToCruiseMinutes(series),
    },
  };
}

async function linkedPanel(
  userId: string,
  header: Header,
  window: [number, number],
  cap: ReadLimits
): Promise<FlightPanel> {
  const { series, truncated } = await readPaged(userId, window, cap, async (read) => {
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
            where: {
              userId,
              entryKind: "flight",
              entryId: header.flightId,
              pointId: { in: readIds },
            },
            select: { pointId: true },
          });
    const linked = new Set(links.map((l) => l.pointId));
    return (row) => linked.has(row.id);
  });
  return panelOf(header, "linked", series, truncated);
}

/** A stored point's source: its device, else its origin (an import names no device). */
const sourceOf = (row: SafePointRow): string => row.deviceId ?? row.origin;

/**
 * The source holding most fixes in the WHOLE window, counted in the database
 * before any cap: picking it from a capped read would let the first fixes
 * outvote the rest. The count only chooses; what is shown still comes from
 * the privacy-safe read.
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
  header: Header,
  window: [number, number],
  cap: ReadLimits
): Promise<FlightPanel> {
  const main = await mainSourceIn(userId, window);
  if (main === null) return emptyPanel(header);
  const { series, truncated } = await readPaged(
    userId,
    window,
    cap,
    async () => (row) => sourceOf(row) === main
  );
  return panelOf(header, "window", series, truncated);
}

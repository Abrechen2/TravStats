import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { buildUserDawarichConnection } from "../dawarich/dawarichResolver";
import { travTrackInstanceOn } from "../travtrack/availability";
import { travTrackBreakSet } from "../travtrack/readSafe";
import { extentOf } from "../../utils/extrema";
import { locationHistoryBatches } from "../tripRecording/historyPoints";
import {
  FLIGHT_WINDOW_SELECT,
  flightRecorderWindow,
  tripRecordingBounds,
  type FlightWindowColumns,
  type RecordingTrip,
} from "../tripRecording/bounds";
import type { RecordingBatchRow, RecordingBreak } from "../tripRecording/segments";
import { dawarichProvider } from "./dawarichProvider";
import { getLocationProvider } from "./provider";
import {
  observationOf,
  TRAVTRACK_OBSERVATION_SELECT,
  travtrackProvider,
} from "./travtrackProvider";
import {
  readAll,
  type Coverage,
  type LocationObservation,
  type LocationProvider,
  type ReadWindow,
} from "./types";

/**
 * Where a flight's or a trip's track comes from (TravTrack plan T5).
 *
 *   - An own recording (`FlightTrack`, `TripRecordingBatch`) is the default,
 *     whatever the provider: recordings made before a switch keep showing,
 *     labelled `travstats`.
 *   - Otherwise the chosen provider: TravTrack's points LINKED to the entry
 *     together with those inside its window (a link keeps a fix recorded for a
 *     delayed flight; the window catches everyday fixes), once each; or
 *     Dawarich's points for the window.
 *   - `alternatives` names the other sources that hold something, and
 *     `?source=` shows one of them explicitly — an extra view, never a silent
 *     swap. A source that holds nothing is 404 `TRACK_SOURCE_NOT_AVAILABLE`.
 *
 * Per device, never flattened: two phones on one trip stay two lines. Dawarich
 * does not name devices, so its points are one device, `null`.
 */

export type TrackOrigin = "travstats" | "travtrack" | "dawarich";
export const TRACK_ORIGINS = ["travstats", "travtrack", "dawarich"] as const;

export type EntryTrackDevice = { deviceId: string | null; points: LocationObservation[] };

export type EntryTrack = {
  origin: TrackOrigin | null;
  coverage: Coverage | null;
  alternatives: TrackOrigin[];
  /**
   * The alternatives offered without being read: Dawarich is remote, and
   * asking it on every page load to learn whether it holds anything is the
   * fan-out the entry pages must not wait on. It is offered because a working
   * connection exists, and said to be unchecked — never claimed to hold data.
   */
  unchecked: TrackOrigin[];
};

const notAvailable = (source: TrackOrigin): AppError =>
  new AppError(`No ${source} track for this entry`, 404, "TRACK_SOURCE_NOT_AVAILABLE");

/** The account's own Dawarich, if it is the chosen and working provider. */
async function chosenDawarich(userId: string): Promise<LocationProvider | null> {
  const state = await getLocationProvider(userId);
  if (state.kind !== "dawarich" || state.status !== "ok") return null;
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  const connection = buildUserDawarichConnection(row?.dawarichBaseUrl, row?.dawarichApiKey);
  return connection ? dawarichProvider(connection) : null;
}

/** TravTrack's points linked to the entry, as observations. */
async function linkedObservations(
  userId: string,
  kind: "flight" | "trip",
  entryId: string
): Promise<LocationObservation[]> {
  const rows = await prisma.travTrackPoint.findMany({
    where: { userId, links: { some: { entryKind: kind, entryId } } },
    orderBy: [{ t: "asc" }, { seq: "asc" }],
    select: TRAVTRACK_OBSERVATION_SELECT,
  });
  return rows.map(observationOf);
}

/** Linked ∪ window, once each, ascending. Empty while the instance is off. */
async function travTrackRead(
  userId: string,
  kind: "flight" | "trip",
  entryId: string,
  window: ReadWindow | null
): Promise<LocationObservation[]> {
  if (!(await travTrackInstanceOn())) return [];
  const [linked, inWindow] = await Promise.all([
    linkedObservations(userId, kind, entryId),
    window ? readAll(travtrackProvider(userId), window).then((r) => r.points) : [],
  ]);
  const byRef = new Map<string, LocationObservation>();
  for (const o of [...inWindow, ...linked]) byRef.set(o.ref, o);
  return [...byRef.values()].sort((a, b) => a.atMs - b.atMs);
}

export function byDevice(points: readonly LocationObservation[]): EntryTrackDevice[] {
  const map = new Map<string | null, LocationObservation[]>();
  for (const p of points) {
    const list = map.get(p.deviceId) ?? [];
    list.push(p);
    map.set(p.deviceId, list);
  }
  return [...map.entries()].map(([deviceId, list]) => ({ deviceId, points: list }));
}

type Plan = { origin: TrackOrigin | null; alternatives: TrackOrigin[]; unchecked: TrackOrigin[] };

/** Which source answers, given what holds something and what was asked for. */
async function choose(
  userId: string,
  own: boolean,
  travTrackHolds: boolean,
  source: TrackOrigin | undefined
): Promise<Plan & { dawarich: LocationProvider | null }> {
  const dawarich = await chosenDawarich(userId);
  const provider = await getLocationProvider(userId);
  const holding: TrackOrigin[] = [
    ...(own ? (["travstats"] as const) : []),
    ...(travTrackHolds ? (["travtrack"] as const) : []),
    ...(dawarich ? (["dawarich"] as const) : []),
  ];
  let origin: TrackOrigin | null;
  if (source) {
    if (!holding.includes(source)) throw notAvailable(source);
    origin = source;
  } else if (own) {
    origin = "travstats";
  } else if (provider.status === "ok" && provider.kind === "travtrack") {
    origin = travTrackHolds ? "travtrack" : null;
  } else {
    origin = dawarich ? "dawarich" : null;
  }
  const alternatives = holding.filter((o) => o !== origin);
  return {
    origin,
    alternatives,
    unchecked: alternatives.filter((o) => o === "dawarich"),
    dawarich,
  };
}

/**
 * A flight's recorder window as a read window, or null when it armed none.
 * Precision-aware, the one window the trip exclusion and the share narrowing
 * use too: a date-only or year-only flight stores a placeholder clock (noon,
 * midnight on the 1st), and a window around it would serve everyday fixes as
 * a flight recording. No window, no window read — only the fixes the phone
 * linked to the flight remain (abstention, not invention).
 */
async function flightWindow(flight: FlightWindowColumns): Promise<ReadWindow | null> {
  const window = await flightRecorderWindow(flight);
  return window ? { fromMs: window[0], untilMs: window[1] + 1 } : null;
}

export async function flightEntryTrack(
  userId: string,
  flight: FlightWindowColumns & { id: string },
  opts: { source?: TrackOrigin } = {}
): Promise<EntryTrack & { window: ReadWindow | null; devices: EntryTrackDevice[] }> {
  const window = await flightWindow(flight);
  const [own, travTrack] = await Promise.all([
    prisma.flightTrack.count({ where: { flightId: flight.id } }),
    travTrackRead(userId, "flight", flight.id, window),
  ]);
  const plan = await choose(userId, own > 0, travTrack.length > 0, opts.source);
  if (plan.origin === "travtrack") {
    return { ...plan, coverage: "complete", window, devices: byDevice(travTrack) };
  }
  if (plan.origin === "dawarich" && plan.dawarich && window) {
    const read = await readAll(plan.dawarich, window);
    if (opts.source === "dawarich" && read.coverage === "complete" && read.points.length === 0) {
      throw notAvailable("dawarich");
    }
    return { ...plan, coverage: read.coverage, window, devices: byDevice(read.points) };
  }
  if (plan.origin === "dawarich") return { ...plan, coverage: null, window, devices: [] };
  return {
    origin: plan.origin,
    alternatives: plan.alternatives,
    unchecked: plan.unchecked,
    coverage: plan.origin ? "complete" : null,
    window,
    devices: [],
  };
}

export async function tripEntryTrack(
  userId: string,
  trip: RecordingTrip,
  opts: { source?: TrackOrigin } = {}
): Promise<EntryTrack & { batches: RecordingBatchRow[] }> {
  const bounds = await tripRecordingBounds(userId, trip);
  const window = bounds ? { fromMs: bounds.fromMs, untilMs: bounds.untilMs } : null;
  const [own, travTrack] = await Promise.all([
    prisma.tripRecordingBatch.findMany({
      where: { tripId: trip.id, userId },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: { deviceId: true, points: true },
    }),
    travTrackRead(userId, "trip", trip.id, window),
  ]);
  const plan = await choose(userId, own.length > 0, travTrack.length > 0, opts.source);
  if (plan.origin === "travstats") return { ...plan, coverage: "complete", batches: own };
  if (plan.origin === null) return { ...plan, coverage: null, batches: [] };
  // TravTrack: the trip's window already read, the links added; Dawarich: its window.
  const provider: LocationProvider | null =
    plan.origin === "travtrack" ? emptyProvider : plan.dawarich;
  const history = await locationHistoryBatches(userId, trip, provider, {
    extra: plan.origin === "travtrack" ? travTrack : [],
    // TravTrack's deleted ranges and reported pauses break its trip line as
    // they break its flight lines; they say nothing about Dawarich's history.
    ...(plan.origin === "travtrack"
      ? { breaksOf: await travTrackBreaksFor(userId, travTrack) }
      : {}),
  });
  if (
    opts.source === "dawarich" &&
    history.coverage === "complete" &&
    history.batches.length === 0
  ) {
    throw notAvailable("dawarich");
  }
  return {
    origin: plan.origin,
    alternatives: plan.alternatives,
    unchecked: plan.unchecked,
    coverage: history.coverage,
    batches: history.batches,
  };
}

/** The break set over the span the points cover; a linked fix may lie outside the trip's days. */
async function travTrackBreaksFor(
  userId: string,
  points: readonly LocationObservation[]
): Promise<(deviceId: string | null) => RecordingBreak[]> {
  // Iteratively: a long history spread into Math.min/max overflows the call.
  const span = extentOf(points.map((p) => p.atMs));
  if (!span) return () => [];
  return travTrackBreakSet(userId, { fromMs: span.min, untilMs: span.max + 1 });
}

/** A provider holding nothing: TravTrack's points for a trip arrive as `extra`. */
const emptyProvider: LocationProvider = {
  kind: "travtrack",
  readPoints: async () => ({ points: [], next: null, coverage: "complete" }),
  getCoverage: async () => ({ coverage: "complete", pointCount: 0, gaps: [] }),
};

/**
 * The plan's generic entry point: one entry, its origin, coverage and
 * alternatives, and its points per device.
 */
export async function entryTrack(
  userId: string,
  entry: { kind: "flight" | "trip"; id: string },
  opts: { source?: TrackOrigin } = {}
): Promise<EntryTrack & { devices: EntryTrackDevice[] }> {
  if (entry.kind === "flight") {
    const flight = await prisma.flight.findFirst({
      where: { id: entry.id, userId },
      select: { id: true, ...FLIGHT_WINDOW_SELECT },
    });
    if (!flight) throw new AppError("Flight not found", 404);
    const { origin, coverage, alternatives, unchecked, devices } = await flightEntryTrack(
      userId,
      flight,
      opts
    );
    return { origin, coverage, alternatives, unchecked, devices };
  }
  const trip = await prisma.trip.findFirst({
    where: { id: entry.id, userId },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      startDay: true,
      endDay: true,
      startZone: true,
      endZone: true,
    },
  });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  const { origin, coverage, alternatives, unchecked, batches } = await tripEntryTrack(
    userId,
    trip,
    opts
  );
  const devices = batches.map((b) => ({
    deviceId: b.deviceId,
    points: (b.points as unknown as Array<[number, number, number, number | null]>).map(
      ([atMs, lat, lon, accuracyM], i) => ({
        ref: `${b.deviceId}:${i}`,
        atMs,
        lat,
        lon,
        accuracyM,
        altitudeM: null,
        speedMps: null,
        courseDeg: null,
        deviceId: b.deviceId,
      })
    ),
  }));
  return { origin, coverage, alternatives, unchecked, devices };
}

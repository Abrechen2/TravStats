import type { Prisma } from "../../prisma";
import { haversineKm } from "../../shared/geo/haversine";
import { simplifyDegrees } from "../schematicRouter";
import { filterJitterYielding, type JitterFix } from "../tracks/jitterFilter";
import { JITTER_PROFILES } from "../tracks/jitterProfiles";
import { localDayReader } from "./localDays";

/**
 * A trip recording read back (forgejo#316): the stored batches as one line per
 * device, cut wherever the phone recorded nothing.
 *
 * A gap is a gap. Two consecutive fixes more than two hours or 50 km apart
 * are two stretches, never joined: a straight line across them would draw a
 * road nobody took — the phone was off, in a plane, in a tunnel, or in a
 * pocket without a fix. 50 km is the hole threshold every stored track uses
 * (`FLIGHT_TRACK_GAP_KM`); two hours is twenty-four of the Companion's
 * five-minute fixes in a row lost.
 *
 * Each device is its own line. Two phones recording the same trip interleave
 * in time; merged into one, they would zigzag between two people.
 */

/** `[tMs, lat, lon, accuracyM | null]`, as stored. */
export type StoredPoint = [number, number, number, number | null];

export const RECORDING_GAP_MS = 2 * 3_600_000;
export const RECORDING_GAP_KM = 50;

/**
 * Display tolerance in degrees (~20 m at the equator). Below the phone's own
 * accuracy at a five-minute fix, so a simplified line drops only vertices no
 * one could tell apart on the map.
 */
const DISPLAY_TOLERANCE_DEG = 0.0002;

const isPoint = (p: unknown): p is StoredPoint =>
  Array.isArray(p) &&
  p.length === 4 &&
  [p[0], p[1], p[2]].every((n) => typeof n === "number" && Number.isFinite(n)) &&
  (p[3] === null || typeof p[3] === "number");

/** A stored `points` column, read defensively: anything that is not a point is left out. */
export function storedPoints(value: Prisma.JsonValue): StoredPoint[] {
  return Array.isArray(value) ? value.filter(isPoint) : [];
}

/**
 * An explicit boundary `[fromMs, untilMs]`: two consecutive points on either
 * side of it are two stretches, however close they lie. Points were taken out
 * there — a flight's recorder window, a privacy zone — and a line joining the
 * two that are left would draw the excluded span as travelled.
 */
export type RecordingBreak = readonly [number, number];

/** Whether an explicit boundary lies between the consecutive points `a` and `b`. */
export function crossesBreak(
  a: StoredPoint,
  b: StoredPoint,
  breaks: readonly RecordingBreak[]
): boolean {
  return breaks.some(([from, until]) => a[0] < until && b[0] > from);
}

/** Whether `b` starts a new stretch after `a`. */
export function isGap(
  a: StoredPoint,
  b: StoredPoint,
  breaks: readonly RecordingBreak[] = []
): boolean {
  if (b[0] - a[0] > RECORDING_GAP_MS) return true;
  if (crossesBreak(a, b, breaks)) return true;
  return haversineKm({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }) > RECORDING_GAP_KM;
}

/** Time-ordered points cut at every gap and every explicit break. Never an empty stretch. */
export function splitAtGaps(
  points: readonly StoredPoint[],
  breaks: readonly RecordingBreak[] = []
): StoredPoint[][] {
  const out: StoredPoint[][] = [];
  let current: StoredPoint[] = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (last && isGap(last, point, breaks)) {
      out.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) out.push(current);
  return out;
}

export interface RecordingBatchRow {
  deviceId: string | null;
  points: Prisma.JsonValue;
  /** Boundaries the device's line must not be joined across (read, never stored). */
  breaks?: readonly RecordingBreak[];
}

/** One device's points in time order and the boundaries its line keeps. */
export type DevicePoints = {
  deviceId: string | null;
  points: StoredPoint[];
  breaks?: readonly RecordingBreak[];
};

/**
 * Each device's points in time order, optionally only those of `day` on the
 * trip's clock `zone`. Devices sorted by id (the browser's `null` last) so the
 * answer is stable.
 */
export function pointsByDevice(
  batches: readonly RecordingBatchRow[],
  zone: string,
  day?: string
): DevicePoints[] {
  const byDevice = new Map<string | null, StoredPoint[]>();
  const breaksOf = new Map<string | null, RecordingBreak[]>();
  const dayOf = localDayReader(zone);
  // Appended in place, not copied per batch: a recording arrives in many
  // small batches, and copying the growing list for each one is quadratic.
  for (const batch of batches) {
    let list = byDevice.get(batch.deviceId);
    if (!list) {
      list = [];
      byDevice.set(batch.deviceId, list);
    }
    if (batch.breaks && batch.breaks.length > 0) {
      breaksOf.set(batch.deviceId, [...(breaksOf.get(batch.deviceId) ?? []), ...batch.breaks]);
    }
    for (const p of storedPoints(batch.points)) {
      if (day === undefined || dayOf(p[0]) === day) list.push(p);
    }
  }
  return [...byDevice.entries()]
    .map(([deviceId, points]) => ({
      deviceId,
      points: points.sort((a, b) => a[0] - b[0]),
      ...(breaksOf.has(deviceId) ? { breaks: breaksOf.get(deviceId) } : {}),
    }))
    .filter((d) => d.points.length > 0)
    .sort((a, b) =>
      a.deviceId === b.deviceId
        ? 0
        : a.deviceId === null
          ? 1
          : b.deviceId === null
            ? -1
            : a.deviceId.localeCompare(b.deviceId)
    );
}

/** Every stretch of every device, `[tMs…]` raw — the GPX's `<trkseg>`s. */
export function rawSegments(
  devices: ReadonlyArray<Pick<DevicePoints, "points" | "breaks">>
): StoredPoint[][] {
  return devices.flatMap((d) => splitAtGaps(d.points, d.breaks));
}

/** The stretches as `[lon, lat]` lines for the map, each simplified on its own. */
export function displaySegments(
  segments: readonly StoredPoint[][]
): Array<Array<[number, number]>> {
  return segments.map((segment) =>
    simplifyDegrees(
      segment.map((p): [number, number] => [p[2], p[1]]),
      DISPLAY_TOLERANCE_DEG
    )
  );
}

/** The distinct days the points fall on, on the trip's clock, in order. */
export function recordingDays(points: readonly StoredPoint[], zone: string): string[] {
  const dayOf = localDayReader(zone);
  return [...new Set(points.map((p) => dayOf(p[0])))].sort();
}

/**
 * Each device's stretches with GPS jitter removed (forgejo#319) — for the MAP
 * only. A phone left on a café table for an hour reports a cloud of positions
 * a hundred metres across, and drawn in time order that cloud is a zigzag.
 * The stored batches and the GPX keep every raw point; this is a reading of
 * them, recomputed on every request, so there is nothing stored to correct.
 *
 * The two halves of the gap rule are applied on either side of the filter:
 * the clock half (> `RECORDING_GAP_MS` without a fix) on the RAW points, where
 * it means the phone recorded nothing — a stay collapsed to its arrival and
 * departure must not read as hours without a fix (review of forgejo#319); the
 * distance half (> `RECORDING_GAP_KM`) on the FILTERED points, so a teleport
 * spike far enough out to look like a 50 km gap is seen as a spike first. A
 * stay comes back as two synthetic points at the middle of its cloud; nothing
 * stores them.
 *
 * A recording has no upper size and this runs on every read, so the filter
 * hands the event loop back every few milliseconds (`pacing.ts`) instead of
 * holding every other request for the length of the recording.
 */
export async function withoutJitter(
  devices: ReadonlyArray<Pick<DevicePoints, "points" | "breaks">>
): Promise<{
  segments: StoredPoint[][];
  dropped: number;
}> {
  let dropped = 0;
  const segments: StoredPoint[][] = [];
  for (const device of devices) {
    const fixes: JitterFix[] = device.points.map(([t, lat, lon, accuracyM]) => ({
      lon,
      lat,
      t,
      accuracyM,
    }));
    // An explicit break is kept like the clock half: on the raw points.
    const breaks = device.breaks ?? [];
    const starts = device.points.flatMap((p, i) => {
      if (i === 0) return [];
      const prev = device.points[i - 1];
      return p[0] - prev[0] > RECORDING_GAP_MS || crossesBreak(prev, p, breaks) ? [i] : [];
    });
    const result = await filterJitterYielding(fixes, starts, JITTER_PROFILES.mixed);
    dropped += result.dropped;
    const points = result.fixes.map((f): StoredPoint => [f.t ?? 0, f.lat, f.lon, f.accuracyM]);
    const bounds = [...result.segmentStarts, points.length];
    for (let k = 0; k + 1 < bounds.length; k++) {
      for (const part of splitAtDistance(points.slice(bounds[k], bounds[k + 1]))) {
        segments.push(part);
      }
    }
  }
  return { segments, dropped };
}

/** The distance half of the gap rule alone. */
function splitAtDistance(points: readonly StoredPoint[]): StoredPoint[][] {
  const out: StoredPoint[][] = [];
  let current: StoredPoint[] = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (
      last &&
      haversineKm({ lat: last[1], lon: last[2] }, { lat: point[1], lon: point[2] }) >
        RECORDING_GAP_KM
    ) {
      out.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) out.push(current);
  return out;
}

import type { Prisma } from "../../prisma";
import { haversineKm } from "../../shared/geo/haversine";
import { localDay } from "../../shared/time/instant";
import { simplifyDegrees } from "../schematicRouter";
import { filterJitter, type JitterFix } from "../tracks/jitterFilter";
import { JITTER_PROFILES } from "../tracks/jitterProfiles";

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

/** Whether `b` starts a new stretch after `a`. */
export function isGap(a: StoredPoint, b: StoredPoint): boolean {
  if (b[0] - a[0] > RECORDING_GAP_MS) return true;
  return haversineKm({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }) > RECORDING_GAP_KM;
}

/** Time-ordered points cut at every gap. Never an empty stretch. */
export function splitAtGaps(points: readonly StoredPoint[]): StoredPoint[][] {
  const out: StoredPoint[][] = [];
  let current: StoredPoint[] = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (last && isGap(last, point)) {
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
}

/**
 * Each device's points in time order, optionally only those of `day` on the
 * trip's clock `zone`. Devices sorted by id (the browser's `null` last) so the
 * answer is stable.
 */
export function pointsByDevice(
  batches: readonly RecordingBatchRow[],
  zone: string,
  day?: string
): Array<{ deviceId: string | null; points: StoredPoint[] }> {
  const byDevice = new Map<string | null, StoredPoint[]>();
  for (const batch of batches) {
    const list = byDevice.get(batch.deviceId) ?? [];
    const kept = storedPoints(batch.points).filter(
      (p) => day === undefined || localDay(new Date(p[0]), zone) === day
    );
    byDevice.set(batch.deviceId, [...list, ...kept]);
  }
  return [...byDevice.entries()]
    .map(([deviceId, points]) => ({
      deviceId,
      points: [...points].sort((a, b) => a[0] - b[0]),
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
export function rawSegments(devices: ReadonlyArray<{ points: StoredPoint[] }>): StoredPoint[][] {
  return devices.flatMap((d) => splitAtGaps(d.points));
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
  return [...new Set(points.map((p) => localDay(new Date(p[0]), zone)))].sort();
}

/**
 * Each device's points with GPS jitter removed (forgejo#319) — for the MAP
 * only. A phone left on a café table for an hour reports a cloud of positions
 * a hundred metres across, and drawn in time order that cloud is a zigzag.
 * The stored batches and the GPX keep every raw point; this is a reading of
 * them, recomputed on every request, so there is nothing stored to correct.
 *
 * Filtered as one stream per device, cut only where the clock stops for
 * longer than `RECORDING_GAP_MS`: a teleport spike far enough out to look like
 * a 50 km gap must be seen as a spike first, not split off as its own
 * stretch. A stay comes back as one synthetic point at its accuracy-weighted
 * centre; nothing stores it.
 */
export function withoutJitter<D extends { points: StoredPoint[] }>(
  devices: readonly D[]
): { devices: D[]; dropped: number } {
  let dropped = 0;
  const clean = devices.map((device) => {
    const fixes: JitterFix[] = device.points.map(([t, lat, lon, accuracyM]) => ({
      lon,
      lat,
      t,
      accuracyM,
    }));
    const starts = device.points.flatMap((p, i) =>
      i > 0 && p[0] - device.points[i - 1][0] > RECORDING_GAP_MS ? [i] : []
    );
    const result = filterJitter(fixes, starts, JITTER_PROFILES.mixed);
    dropped += result.dropped;
    return {
      ...device,
      points: result.fixes.map((f): StoredPoint => [f.t ?? 0, f.lat, f.lon, f.accuracyM]),
    };
  });
  return { devices: clean, dropped };
}

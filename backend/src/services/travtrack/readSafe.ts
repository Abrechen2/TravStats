import { prisma } from "../../db";
import {
  rawSegments,
  type DevicePoints,
  type RecordingBreak,
  type StoredPoint,
} from "../tripRecording/segments";
import { privacySafeDevices, privacySafeStretches } from "../tripRecording/privacySafe";
import type { ZoneCircle } from "./classify";
import { privacyCirclesFor } from "./privacyCircles";

/**
 * A span of the account's TravTrack history as it may leave the server
 * (TravTrack plan T6): read per device, cut at every gap, at every deleted
 * span and at every pause the phone reported, and privacy-cut — whatever a
 * zone hides is gone before anything is counted, drawn or exported (review
 * focus 10). The day view and the export both read through here.
 *
 * Bounded: at most `cap` points are read. `next` names the first instant left
 * unread, so a reader says the answer is truncated instead of passing it off
 * as the whole span, and `cursor` the last point read by the read's own order
 * `(t, seq)`: points sharing an instant can fall either side of a part's end
 * (or outnumber a part), so a continuation carries both, never the time
 * alone — which repeated the points of that instant, or looped on them.
 */

export const TRAVTRACK_SAFE_SELECT = {
  id: true,
  t: true,
  lat: true,
  lon: true,
  accuracyM: true,
  altitudeM: true,
  speedMps: true,
  course: true,
  motion: true,
  deviceId: true,
  origin: true,
  purpose: true,
  seq: true,
} as const;

export type SafePointRow = {
  /** The point's stable id: what a single-point delete names (plan T5.3). */
  id: string;
  t: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  course: number | null;
  /** What the phone said about movement (`stationary`, `walking`, …), as stored. */
  motion: string | null;
  deviceId: string | null;
  /** Where the point came from: `companion:<deviceId>`, `gpx:<importId>`, … */
  origin: string;
  purpose: string;
  seq: bigint;
};

/** A position in the read's order: after the point at `tMs` with this `seq`. */
export type SafeCursor = { tMs: number; seq: bigint };

const CURSOR = /^(\d{1,15}):(\d{1,19})$/;

export const formatSafeCursor = (c: SafeCursor): string => `${c.tMs}:${c.seq}`;

/** The cursor a continuation carries, or null when it is not one. */
export function parseSafeCursor(text: string | undefined): SafeCursor | null {
  const m = text ? CURSOR.exec(text) : null;
  return m ? { tMs: Number(m[1]), seq: BigInt(m[2]) } : null;
}

export type Span = { fromMs: number; untilMs: number };

export type SafeSpan = {
  /** The stretches, `[tMs, lat, lon, accuracyM]`, every one cut and privacy-cut. */
  segments: StoredPoint[][];
  /** The row each vertex came from (identity-keyed). */
  rowOf: (point: StoredPoint) => SafePointRow | undefined;
  circles: ZoneCircle[];
  deleted: Span[];
  paused: Array<Span & { deviceId: string; reason: string }>;
  /**
   * Instants of every fix read but left out of `segments` (privacy cut, chords through a zone). Internal: it tells a derivation
   * that a silence between two stretches holds a hidden visit and must never be joined over.
   */
  removedAtMs?: number[];
  /** The first instant not read, or null when the span was read whole. */
  next: Date | null;
  /** The last point read, where a continuation picks up; null when read whole. */
  cursor: SafeCursor | null;
};

const clip = (from: Date, to: Date, window: Span): Span => ({
  fromMs: Math.max(from.getTime(), window.fromMs),
  untilMs: Math.min(to.getTime(), window.untilMs),
});

export async function readSafeTravTrack(
  userId: string,
  window: Span,
  cap: number,
  after: SafeCursor | null = null
): Promise<SafeSpan> {
  const range = { gte: new Date(window.fromMs), lt: new Date(window.untilMs) };
  const afterWhere = after
    ? {
        OR: [
          { t: { gt: new Date(after.tMs) } },
          { t: new Date(after.tMs), seq: { gt: after.seq } },
        ],
      }
    : {};
  const overlapping = {
    userId,
    fromAt: { lt: new Date(window.untilMs) },
    toAt: { gt: new Date(window.fromMs) },
  };
  const [rows, deletedRows, gapRows, circles, tombstones] = await Promise.all([
    prisma.travTrackPoint.findMany({
      where: { userId, t: range, ...afterWhere },
      orderBy: [{ t: "asc" }, { seq: "asc" }],
      take: cap + 1,
      select: TRAVTRACK_SAFE_SELECT,
    }),
    prisma.travTrackDeletedRange.findMany({
      where: overlapping,
      orderBy: { fromAt: "asc" },
      select: { fromAt: true, toAt: true },
    }),
    prisma.travTrackGap.findMany({
      where: overlapping,
      orderBy: { fromAt: "asc" },
      select: { fromAt: true, toAt: true, deviceId: true, reason: true },
    }),
    privacyCirclesFor(userId, window.fromMs),
    // Points deleted one by one are never read, but the silence they leave must not be bridged.
    prisma.travTrackDeletedPoint.findMany({
      where: {
        userId,
        tS: { gte: Math.floor(window.fromMs / 1000), lt: Math.ceil(window.untilMs / 1000) },
      },
      select: { tS: true },
    }),
  ]);
  const read = rows.slice(0, cap);
  const next = rows.length > cap ? rows[cap].t : null;
  const last = read[read.length - 1];
  const cursor = next && last ? { tMs: last.t.getTime(), seq: last.seq } : null;

  const deleted = deletedRows.map((r) => clip(r.fromAt, r.toAt, window));
  const paused = gapRows.map((g) => ({
    ...clip(g.fromAt, g.toAt, window),
    deviceId: g.deviceId,
    reason: g.reason,
  }));

  const rowByPoint = new WeakMap<StoredPoint, SafePointRow>();
  const byDevice = new Map<string | null, StoredPoint[]>();
  for (const row of read) {
    const point: StoredPoint = [row.t.getTime(), row.lat, row.lon, row.accuracyM];
    rowByPoint.set(point, row);
    const list = byDevice.get(row.deviceId) ?? [];
    list.push(point);
    byDevice.set(row.deviceId, list);
  }
  // A deleted span breaks every device's line; a reported pause breaks its own.
  const deletedBreaks = deleted.map((d): [number, number] => [d.fromMs, d.untilMs]);
  const devices: DevicePoints[] = [...byDevice.entries()].map(([deviceId, points]) => ({
    deviceId,
    points,
    breaks: [
      ...deletedBreaks,
      ...paused
        .filter((p) => p.deviceId === deviceId)
        .map((p): [number, number] => [p.fromMs, p.untilMs]),
    ],
  }));
  // The safe devices are already the cut; the stretches go through it once
  // more as they leave, so the output itself is what was checked.
  const segments = privacySafeStretches(rawSegments(privacySafeDevices(devices, circles)), circles);
  // Every fix read but not returned (a zone, a chord through one, a lone survivor): the silence
  // it leaves must never be bridged. Fail closed: any reason, any device.
  const kept = new Set(segments.flat());
  const removedAtMs = [
    ...[...byDevice.values()].flatMap((pts) => pts.filter((p) => !kept.has(p)).map((p) => p[0])),
    ...tombstones.map((t) => t.tS * 1000),
  ];
  return {
    segments,
    rowOf: (p) => rowByPoint.get(p),
    circles,
    removedAtMs,
    deleted,
    paused,
    next,
    cursor,
  };
}

/**
 * The spans a TravTrack line of this account must not be joined across
 * within `window`, asked per device: every deleted range (it breaks every
 * device's line) and the pauses that device reported. Read once for a read
 * that draws many lines (the map). A flight line built from TravTrack points
 * goes through these exactly as the day view and the export do.
 */
export async function travTrackBreakSet(
  userId: string,
  window: Span
): Promise<(deviceId: string | null) => RecordingBreak[]> {
  const overlapping = {
    userId,
    fromAt: { lt: new Date(window.untilMs) },
    toAt: { gt: new Date(window.fromMs) },
  };
  const [deletedRows, gapRows] = await Promise.all([
    prisma.travTrackDeletedRange.findMany({
      where: overlapping,
      select: { fromAt: true, toAt: true },
    }),
    prisma.travTrackGap.findMany({
      where: overlapping,
      select: { fromAt: true, toAt: true, deviceId: true },
    }),
  ]);
  const deleted = deletedRows.map((r): RecordingBreak => [r.fromAt.getTime(), r.toAt.getTime()]);
  return (deviceId) => [
    ...deleted,
    ...gapRows
      .filter((g) => g.deviceId === deviceId)
      .map((g): RecordingBreak => [g.fromAt.getTime(), g.toAt.getTime()]),
  ];
}

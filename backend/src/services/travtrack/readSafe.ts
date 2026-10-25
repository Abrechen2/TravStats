import { prisma } from "../../db";
import { rawSegments, type DevicePoints, type StoredPoint } from "../tripRecording/segments";
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
 * as the whole span.
 */

export const TRAVTRACK_SAFE_SELECT = {
  t: true,
  lat: true,
  lon: true,
  accuracyM: true,
  altitudeM: true,
  speedMps: true,
  course: true,
  deviceId: true,
  purpose: true,
} as const;

export type SafePointRow = {
  t: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  course: number | null;
  deviceId: string | null;
  purpose: string;
};

export type Span = { fromMs: number; untilMs: number };

export type SafeSpan = {
  /** The stretches, `[tMs, lat, lon, accuracyM]`, every one cut and privacy-cut. */
  segments: StoredPoint[][];
  /** The row each vertex came from (identity-keyed). */
  rowOf: (point: StoredPoint) => SafePointRow | undefined;
  circles: ZoneCircle[];
  deleted: Span[];
  paused: Array<Span & { deviceId: string; reason: string }>;
  /** The first instant not read, or null when the span was read whole. */
  next: Date | null;
};

const clip = (from: Date, to: Date, window: Span): Span => ({
  fromMs: Math.max(from.getTime(), window.fromMs),
  untilMs: Math.min(to.getTime(), window.untilMs),
});

export async function readSafeTravTrack(
  userId: string,
  window: Span,
  cap: number
): Promise<SafeSpan> {
  const range = { gte: new Date(window.fromMs), lt: new Date(window.untilMs) };
  const overlapping = {
    userId,
    fromAt: { lt: new Date(window.untilMs) },
    toAt: { gt: new Date(window.fromMs) },
  };
  const [rows, deletedRows, gapRows, circles] = await Promise.all([
    prisma.travTrackPoint.findMany({
      where: { userId, t: range },
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
  ]);
  const read = rows.slice(0, cap);
  const next = rows.length > cap ? rows[cap].t : null;

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
  return { segments, rowOf: (p) => rowByPoint.get(p), circles, deleted, paused, next };
}

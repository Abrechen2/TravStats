import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { DIAGNOSTICS_RETENTION_DAYS } from "../../../schemas/travtrackDiagnostics";
import { dayAfter, midnightOf } from "../range";
import {
  analyseGaps,
  type CarriedState,
  type FixBucket,
  type GapCause,
  type GapEvidence,
  type LogEvent,
} from "./analyze";

/**
 * Reads a device's diagnostics day and lines it up with its stored points
 * (spec 2026-10-29-travtrack-diagnostics). The analysis runs over EVERY event
 * of the day — only the list handed back is capped — so a busy log never
 * makes a gap look silent.
 */

export const DAY_EVENTS_RETURNED = 2000;
/** A points upload can leave the phone long after its fixes: look this far past the day. */
const UPLOAD_LOOKAHEAD_MS = 3 * 86_400_000;
const MINUTE = 60_000;
/** As far back as the analysis' no-log rule looks (`analyze.ts`). */
const LOOKBACK_MS = 30 * MINUTE;

export interface DiagnosticsDevice {
  deviceId: string;
  label: string | null;
  model: string | null;
  os: string | null;
  appVersion: string | null;
  events: number;
  points: number;
}

export interface DiagnosticsDay {
  date: string;
  zone: string;
  /** The day's window as read (a running day ends now). */
  from: string;
  until: string;
  deviceId: string | null;
  devices: DiagnosticsDevice[];
  hasLog: boolean;
  pointsPerMinute: { t: string; n: number }[];
  fixesPerMinute: { t: string; received: number; kept: number; dropped: Record<string, number> }[];
  events: { id: string; t: string; kind: string; data: unknown }[];
  eventsTruncated: boolean;
  carried: CarriedState;
  gaps: { from: string; to: string; minutes: number; cause: GapCause; evidence: GapEvidence }[];
}

const iso = (ms: number): string => new Date(ms).toISOString();
const asData = (value: Prisma.JsonValue): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Sums the minute deltas of `fixes` events into one bucket per minute. */
export function sumFixes(rows: readonly { t: Date; data: Prisma.JsonValue }[]): FixBucket[] {
  const byMinute = new Map<number, FixBucket>();
  for (const row of rows) {
    const tMs = Math.floor(row.t.getTime() / MINUTE) * MINUTE;
    const data = asData(row.data);
    const bucket = byMinute.get(tMs) ?? { tMs, received: 0, kept: 0, dropped: {} };
    const dropped = { ...bucket.dropped };
    const raw = asData((data.dropped ?? null) as Prisma.JsonValue);
    for (const [reason, n] of Object.entries(raw))
      dropped[reason] = (dropped[reason] ?? 0) + num(n);
    byMinute.set(tMs, {
      tMs,
      received: bucket.received + num(data.received),
      kept: bucket.kept + num(data.kept),
      dropped,
    });
  }
  return [...byMinute.values()].sort((a, b) => a.tMs - b.tMs);
}

async function devicesOf(
  userId: string,
  fromMs: number,
  untilMs: number
): Promise<DiagnosticsDevice[]> {
  const window = { gte: new Date(fromMs), lt: new Date(untilMs) };
  const [eventCounts, pointCounts] = await Promise.all([
    prisma.travTrackDiagnosticEvent.groupBy({
      by: ["deviceId"],
      where: { userId, t: window },
      _count: { _all: true },
    }),
    prisma.travTrackPoint.groupBy({
      by: ["deviceId"],
      where: { userId, t: window, deviceId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const ids = [
    ...new Set([
      ...eventCounts.map((r) => r.deviceId),
      ...pointCounts.map((r) => r.deviceId).filter((d): d is string => d !== null),
    ]),
  ];
  if (ids.length === 0) return [];
  const [tokens, receipts] = await Promise.all([
    prisma.apiToken.findMany({
      where: { userId, deviceId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: { deviceId: true, label: true },
    }),
    prisma.travTrackDiagnosticUpload.findMany({
      where: { userId, deviceId: { in: ids } },
      orderBy: { createdAt: "desc" },
      distinct: ["deviceId"],
      select: { deviceId: true, device: true },
    }),
  ]);
  return ids
    .map((deviceId) => {
      const device = asData(receipts.find((r) => r.deviceId === deviceId)?.device ?? null);
      const text = (k: string) => (typeof device[k] === "string" ? (device[k] as string) : null);
      return {
        deviceId,
        label: tokens.find((t) => t.deviceId === deviceId)?.label ?? null,
        model: text("model"),
        os: text("os"),
        appVersion: text("appVersion"),
        events: eventCounts.find((r) => r.deviceId === deviceId)?._count._all ?? 0,
        points: pointCounts.find((r) => r.deviceId === deviceId)?._count._all ?? 0,
      };
    })
    .sort((a, b) => b.events - a.events || b.points - a.points);
}

/** The latest state of each carried kind before the day, back to the retention horizon. */
async function carriedInto(
  userId: string,
  deviceId: string,
  fromMs: number
): Promise<CarriedState> {
  const horizon = new Date(fromMs - DIAGNOSTICS_RETENTION_DAYS * 86_400_000);
  const latest = async (kind: string, key: string): Promise<string | undefined> => {
    const row = await prisma.travTrackDiagnosticEvent.findFirst({
      where: { userId, deviceId, kind, t: { gte: horizon, lt: new Date(fromMs) } },
      orderBy: { t: "desc" },
      select: { data: true },
    });
    const value = row ? asData(row.data)[key] : undefined;
    return typeof value === "string" ? value : undefined;
  };
  const [permission, recorder, lifecycle] = await Promise.all([
    latest("permission", "status"),
    latest("recorder", "event"),
    latest("lifecycle", "event"),
  ]);
  return {
    ...(permission ? { permission } : {}),
    ...(recorder ? { recorder } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  };
}

export async function diagnosticsDay(
  userId: string,
  date: string,
  wantedDevice: string | undefined,
  nowMs: number = Date.now()
): Promise<DiagnosticsDay> {
  const { zone } = await profileZoneOf(userId);
  const fromMs = midnightOf(date, zone).getTime();
  // A day still running ends now: the hours to come are not a gap.
  const untilMs = Math.min(midnightOf(dayAfter(date), zone).getTime(), nowMs);
  const devices = untilMs > fromMs ? await devicesOf(userId, fromMs, untilMs) : [];
  const deviceId = wantedDevice ?? devices[0]?.deviceId ?? null;
  const empty: DiagnosticsDay = {
    date,
    zone,
    from: iso(fromMs),
    until: iso(Math.max(untilMs, fromMs)),
    deviceId,
    devices,
    hasLog: false,
    pointsPerMinute: [],
    fixesPerMinute: [],
    events: [],
    eventsTruncated: false,
    carried: {},
    gaps: [],
  };
  if (deviceId === null || untilMs <= fromMs) return empty;

  const window = { gte: new Date(fromMs), lt: new Date(untilMs) };
  const [points, fixRows, eventRows, earlier, laterUploads, reported, carried] = await Promise.all([
    prisma.travTrackPoint.findMany({
      where: { userId, deviceId, t: window },
      orderBy: { t: "asc" },
      select: { t: true },
    }),
    prisma.travTrackDiagnosticEvent.findMany({
      where: { userId, deviceId, kind: "fixes", t: window },
      select: { t: true, data: true },
    }),
    prisma.travTrackDiagnosticEvent.findMany({
      where: { userId, deviceId, kind: { not: "fixes" }, t: window },
      orderBy: [{ t: "asc" }, { id: "asc" }],
      select: { id: true, t: true, kind: true, data: true },
    }),
    // The no-log rule looks 30 minutes back: an early gap may have been
    // spoken for before midnight.
    prisma.travTrackDiagnosticEvent.findMany({
      where: {
        userId,
        deviceId,
        t: { gte: new Date(fromMs - LOOKBACK_MS), lt: new Date(fromMs) },
      },
      orderBy: { t: "asc" },
      select: { t: true, kind: true, data: true },
    }),
    prisma.travTrackDiagnosticEvent.findMany({
      where: {
        userId,
        deviceId,
        kind: "upload",
        t: { gte: new Date(untilMs), lt: new Date(untilMs + UPLOAD_LOOKAHEAD_MS) },
      },
      orderBy: { t: "asc" },
      select: { t: true, kind: true, data: true },
    }),
    prisma.travTrackGap.findMany({
      where: {
        userId,
        deviceId,
        fromAt: { lt: new Date(untilMs) },
        toAt: { gt: new Date(fromMs) },
      },
      select: { fromAt: true, toAt: true, reason: true },
    }),
    carriedInto(userId, deviceId, fromMs),
  ]);

  const fixes = sumFixes(fixRows);
  const earlierFixes = sumFixes(earlier.filter((e) => e.kind === "fixes"));
  const events: LogEvent[] = [
    ...earlier.filter((e) => e.kind !== "fixes"),
    ...eventRows,
    ...laterUploads,
  ].map((e) => ({
    tMs: e.t.getTime(),
    kind: e.kind,
    data: asData(e.data),
  }));
  const uploadIds = events
    .filter((e) => e.kind === "upload" && typeof e.data.uploadId === "string")
    .map((e) => e.data.uploadId as string);
  const receipts = uploadIds.length
    ? await prisma.travTrackUpload.findMany({
        where: { userId, uploadId: { in: uploadIds } },
        select: { uploadId: true },
      })
    : [];

  const pointTimes = points.map((p) => p.t.getTime());
  const gaps = analyseGaps({
    fromMs,
    untilMs,
    pointTimes,
    fixes: [...earlierFixes, ...fixes],
    events,
    carried,
    reported: reported.map((r) => ({
      fromMs: r.fromAt.getTime(),
      toMs: r.toAt.getTime(),
      reason: r.reason,
    })),
    receipts: new Set(receipts.map((r) => r.uploadId)),
    hasLog: fixRows.length > 0 || eventRows.length > 0,
  });

  const perMinute = new Map<number, number>();
  for (const t of pointTimes) {
    const minute = Math.floor(t / MINUTE) * MINUTE;
    perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
  }

  return {
    ...empty,
    hasLog: fixRows.length > 0 || eventRows.length > 0,
    pointsPerMinute: [...perMinute].map(([t, n]) => ({ t: iso(t), n })),
    fixesPerMinute: fixes.map((f) => ({
      t: iso(f.tMs),
      received: f.received,
      kept: f.kept,
      dropped: f.dropped,
    })),
    events: eventRows
      .slice(0, DAY_EVENTS_RETURNED)
      .map((e) => ({ id: e.id, t: e.t.toISOString(), kind: e.kind, data: e.data })),
    eventsTruncated: eventRows.length > DAY_EVENTS_RETURNED,
    carried,
    gaps: gaps.map((g) => ({
      from: iso(g.fromMs),
      to: iso(g.toMs),
      minutes: Math.round((g.toMs - g.fromMs) / MINUTE),
      cause: g.cause,
      evidence: g.evidence,
    })),
  };
}

export interface DiagnosticsExport {
  exportedAt: string;
  from: string;
  to: string;
  devices: DiagnosticsDevice[];
  events: { deviceId: string; t: string; kind: string; data: unknown }[];
  pointsPerMinute: { deviceId: string; t: string; n: number }[];
}

export async function diagnosticsExport(
  userId: string,
  from: string,
  to: string,
  deviceId: string | undefined,
  nowMs: number = Date.now()
): Promise<DiagnosticsExport> {
  const fromMs = Date.parse(from);
  const untilMs = Date.parse(to);
  const window = { gte: new Date(fromMs), lt: new Date(untilMs) };
  const [devices, events, points] = await Promise.all([
    devicesOf(userId, fromMs, untilMs),
    prisma.travTrackDiagnosticEvent.findMany({
      where: { userId, t: window, ...(deviceId ? { deviceId } : {}) },
      orderBy: [{ t: "asc" }, { id: "asc" }],
      select: { deviceId: true, t: true, kind: true, data: true },
    }),
    prisma.travTrackPoint.findMany({
      where: { userId, t: window, ...(deviceId ? { deviceId } : { deviceId: { not: null } }) },
      select: { deviceId: true, t: true },
    }),
  ]);
  const perMinute = new Map<string, number>();
  for (const p of points) {
    const key = `${p.deviceId}|${Math.floor(p.t.getTime() / MINUTE) * MINUTE}`;
    perMinute.set(key, (perMinute.get(key) ?? 0) + 1);
  }
  return {
    exportedAt: iso(nowMs),
    from: iso(fromMs),
    to: iso(untilMs),
    devices: deviceId ? devices.filter((d) => d.deviceId === deviceId) : devices,
    events: events.map((e) => ({
      deviceId: e.deviceId,
      t: e.t.toISOString(),
      kind: e.kind,
      data: e.data,
    })),
    pointsPerMinute: [...perMinute]
      .map(([key, n]) => {
        const [device, t] = key.split("|");
        return { deviceId: device, t: iso(Number(t)), n };
      })
      .sort((a, b) => a.t.localeCompare(b.t)),
  };
}

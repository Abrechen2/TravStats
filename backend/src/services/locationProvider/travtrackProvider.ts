import { prisma } from "../../db";
import type { LocationObservation, LocationProvider, ReadWindow } from "./types";

/**
 * TravTrack's points as a `LocationProvider` (TravTrack plan T4, from the
 * archived internal reader). Ascending by `(t, seq)`, a page at most `cap`
 * points, and a cursor `<tMs>:<seq>` while more remain — the oldest slice is
 * never silently dropped, so every page is `complete`.
 */

export const TRAVTRACK_PAGE_CAP = 50_000;

const SELECT = {
  seq: true,
  t: true,
  lat: true,
  lon: true,
  accuracyM: true,
  altitudeM: true,
  speedMps: true,
  course: true,
  deviceId: true,
} as const;

type Row = {
  seq: bigint;
  t: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  course: number | null;
  deviceId: string | null;
};

export const observationOf = (row: Row): LocationObservation => ({
  ref: row.seq.toString(),
  atMs: row.t.getTime(),
  lat: row.lat,
  lon: row.lon,
  accuracyM: row.accuracyM,
  altitudeM: row.altitudeM,
  speedMps: row.speedMps,
  courseDeg: row.course,
  deviceId: row.deviceId,
});

export const TRAVTRACK_OBSERVATION_SELECT = SELECT;

function afterCursor(cursor: string | undefined) {
  const match = cursor ? /^(\d{1,15}):(\d{1,19})$/.exec(cursor) : null;
  if (!match) return {};
  const t = new Date(Number(match[1]));
  const seq = BigInt(match[2]);
  return { OR: [{ t: { gt: t } }, { t, seq: { gt: seq } }] };
}

export function travtrackProvider(userId: string, cap = TRAVTRACK_PAGE_CAP): LocationProvider {
  const inWindow = (w: ReadWindow) => ({
    userId,
    t: { gte: new Date(w.fromMs), lt: new Date(w.untilMs) },
  });
  return {
    kind: "travtrack",
    async readPoints(window, cursor) {
      const rows = await prisma.travTrackPoint.findMany({
        where: { ...inWindow(window), ...afterCursor(cursor) },
        orderBy: [{ t: "asc" }, { seq: "asc" }],
        take: cap + 1,
        select: SELECT,
      });
      const page = rows.slice(0, cap);
      const last = page[page.length - 1];
      return {
        points: page.map(observationOf),
        next: rows.length > cap && last ? `${last.t.getTime()}:${last.seq}` : null,
        coverage: "complete",
      };
    },
    async getCoverage(window) {
      const from = new Date(window.fromMs);
      const until = new Date(window.untilMs);
      const overlap = { userId, fromAt: { lt: until }, toAt: { gt: from } };
      const [pointCount, deleted, reported] = await Promise.all([
        prisma.travTrackPoint.count({ where: inWindow(window) }),
        prisma.travTrackDeletedRange.findMany({
          where: overlap,
          select: { fromAt: true, toAt: true },
        }),
        prisma.travTrackGap.findMany({ where: overlap, select: { fromAt: true, toAt: true } }),
      ]);
      const gaps = [
        ...deleted.map((r) => ({ r, reason: "deleted" as const })),
        ...reported.map((r) => ({ r, reason: "reported" as const })),
      ]
        .map(({ r, reason }) => ({
          fromMs: Math.max(r.fromAt.getTime(), window.fromMs),
          untilMs: Math.min(r.toAt.getTime(), window.untilMs),
          reason,
        }))
        .sort((a, b) => a.fromMs - b.fromMs);
      return { coverage: "complete", pointCount, gaps };
    },
  };
}

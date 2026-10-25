import type { DawarichPoint } from "../dawarichClient";

export const RADIUS_METERS = 150;
const MIN_DURATION_MS = 20 * 60_000;
const MAX_GAP_MS = 30 * 60_000;

export function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
/**
 * A point id: Dawarich's number, or a TravTrack point's digest (TravTrack plan
 * E3). The detectors only compare ids of one source with each other.
 */
export type PointId = number | string;
/** What the stay and market detectors read: a Dawarich point, or a TravTrack one in its shape. */
export type StayPoint = Omit<DawarichPoint, "id"> & { id: PointId };
const location = (p: StayPoint) => ({ lat: p.latitude, lon: p.longitude });
export interface StayCandidate {
  startAt: Date;
  endAt: Date;
  lat: number;
  lon: number;
  pointCount: number;
  pointIds: PointId[];
  uncertainties: string[];
  maxGapMinutes: number;
}

/** Conservative stationary clusters. Never interprets a hotel position as an overnight stay. */
export function detectStays(input: readonly StayPoint[], truncated = false): StayCandidate[] {
  const points = [
    ...new Map(
      input
        .filter(
          (p) =>
            Number.isFinite(p.timestampMs) &&
            Math.abs(p.latitude) <= 90 &&
            Math.abs(p.longitude) <= 180 &&
            (p.accuracy === null || (p.accuracy >= 0 && p.accuracy <= 100)) &&
            (p.velocity === null || (Number.isFinite(p.velocity) && p.velocity >= 0))
        )
        .map((p) => [p.timestampMs, p])
    ).values(),
  ].sort((a, b) => a.timestampMs - b.timestampMs);
  const result: StayCandidate[] = [];
  let group: StayPoint[] = [];
  let skipped = 0;
  const flush = () => {
    if (group.length >= 3 && group.at(-1)!.timestampMs - group[0].timestampMs >= MIN_DURATION_MS) {
      // A reduce, not Math.max(...gaps): a month at home logged every few
      // seconds is several hundred thousand points and overflowed the stack.
      const maxGapMinutes = group
        .slice(1)
        .reduce((max, p, i) => Math.max(max, (p.timestampMs - group[i].timestampMs) / 60_000), 0);
      result.push({
        startAt: new Date(group[0].timestampMs),
        endAt: new Date(group.at(-1)!.timestampMs),
        lat: group.reduce((n, p) => n + p.latitude, 0) / group.length,
        // Circular mean keeps a cluster spanning +180/-180 at the dateline.
        lon:
          (Math.atan2(
            group.reduce((n, p) => n + Math.sin((p.longitude * Math.PI) / 180), 0),
            group.reduce((n, p) => n + Math.cos((p.longitude * Math.PI) / 180), 0)
          ) *
            180) /
          Math.PI,
        pointCount: group.length,
        pointIds: group.map((p) => p.id),
        maxGapMinutes,
        uncertainties: [
          "sourceUnknown",
          ...(group.some((p) => p.accuracy === null) ? ["accuracyUnknown"] : []),
          ...(maxGapMinutes > 10 ? ["signalGaps"] : []),
          ...(skipped ? ["outliersIgnored"] : []),
          ...(truncated ? ["truncated"] : []),
        ],
      });
    }
    group = [];
    skipped = 0;
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (group.length) {
      const previous = group.at(-1)!;
      const close = meters(location(group[0]), location(p)) <= RADIUS_METERS;
      if (!close) {
        const next = points[i + 1];
        // One isolated jump, bounded on BOTH sides by the same stationary cluster.
        if (
          next &&
          next.timestampMs - previous.timestampMs <= MAX_GAP_MS &&
          meters(location(group[0]), location(next)) <= RADIUS_METERS
        ) {
          skipped++;
          continue;
        }
      }
      if (
        !close ||
        p.timestampMs - previous.timestampMs > MAX_GAP_MS ||
        (p.velocity !== null && p.velocity > 3)
      )
        flush();
    }
    if (p.velocity === null || p.velocity <= 3) group.push(p);
  }
  flush();
  return result;
}

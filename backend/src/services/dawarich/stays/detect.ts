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
const location = (p: DawarichPoint) => ({ lat: p.latitude, lon: p.longitude });
export interface StayCandidate {
  startAt: Date;
  endAt: Date;
  lat: number;
  lon: number;
  pointCount: number;
  pointIds: number[];
  uncertainties: string[];
  maxGapMinutes: number;
}

/** Conservative stationary clusters. Never interprets a hotel position as an overnight stay. */
export function detectStays(input: readonly DawarichPoint[], truncated = false): StayCandidate[] {
  const points = [
    ...new Map(
      input
        .filter(
          (p) =>
            Number.isFinite(p.timestampMs) &&
            Math.abs(p.latitude) <= 90 &&
            Math.abs(p.longitude) <= 180 &&
            (p.accuracy === null || (p.accuracy >= 0 && p.accuracy <= 100))
        )
        .map((p) => [p.timestampMs, p])
    ).values(),
  ].sort((a, b) => a.timestampMs - b.timestampMs);
  const result: StayCandidate[] = [];
  let group: DawarichPoint[] = [];
  let skipped = 0;
  const flush = () => {
    if (group.length >= 3 && group.at(-1)!.timestampMs - group[0].timestampMs >= MIN_DURATION_MS) {
      const maxGapMinutes = Math.max(
        ...group.slice(1).map((p, i) => (p.timestampMs - group[i].timestampMs) / 60_000)
      );
      result.push({
        startAt: new Date(group[0].timestampMs),
        endAt: new Date(group.at(-1)!.timestampMs),
        lat: group.reduce((n, p) => n + p.latitude, 0) / group.length,
        lon: group.reduce((n, p) => n + p.longitude, 0) / group.length,
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

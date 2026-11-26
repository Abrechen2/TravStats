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
  const groups: Group[] = [];
  let group: StayPoint[] = [];
  let skipped = 0;
  const flush = () => {
    if (group.length >= 3 && group.at(-1)!.timestampMs - group[0].timestampMs >= MIN_DURATION_MS)
      groups.push({ points: group, skipped });
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
  return mergeFragments(groups, points).map((g) => candidateOf(g, truncated));
}

type Group = { points: StayPoint[]; skipped: number };

/** Two stays this close in time are one, when nothing in between says the device left. */
export const MERGE_GAP_MS = 45 * 60_000;

const centre = (group: readonly StayPoint[]) => ({
  lat: group.reduce((n, p) => n + p.latitude, 0) / group.length,
  // Circular mean keeps a cluster spanning +180/-180 at the dateline.
  lon:
    (Math.atan2(
      group.reduce((n, p) => n + Math.sin((p.longitude * Math.PI) / 180), 0),
      group.reduce((n, p) => n + Math.cos((p.longitude * Math.PI) / 180), 0)
    ) *
      180) /
    Math.PI,
});

/**
 * Consecutive stays at one place, split by a single fast fix, a drifting anchor or a quiet
 * phone, become one stay again (prod, 24.11.2026: 10:16-11:55 and 11:56-14:15 at the same
 * spot; 25.11.: four stays at one building with gaps of 0-40 min). Merged only when the two
 * centres lie within the stay radius, the gap is at most `MERGE_GAP_MS`, and no fix recorded
 * in the gap lies further than twice the radius from the first stay — a walk to the shop and
 * back keeps its two stays. Every point of both stays (and the gap's) is kept as evidence.
 */
function mergeFragments(groups: readonly Group[], points: readonly StayPoint[]): Group[] {
  const merged: Group[] = [];
  for (const next of groups) {
    const last = merged.at(-1);
    if (last && sameStay(last, next, points)) {
      const gap = between(points, last.points.at(-1)!.timestampMs, next.points[0].timestampMs);
      const quiet = gap.filter((p) => p.velocity === null || p.velocity <= 3);
      merged[merged.length - 1] = {
        points: [...last.points, ...quiet, ...next.points],
        skipped: last.skipped + next.skipped + (gap.length - quiet.length),
      };
    } else merged.push(next);
  }
  return merged;
}

function sameStay(a: Group, b: Group, points: readonly StayPoint[]): boolean {
  const aEnd = a.points.at(-1)!.timestampMs;
  const bStart = b.points[0].timestampMs;
  if (bStart - aEnd > MERGE_GAP_MS) return false;
  const at = centre(a.points);
  if (meters(at, centre(b.points)) > RADIUS_METERS) return false;
  return between(points, aEnd, bStart).every((p) => meters(at, location(p)) <= RADIUS_METERS * 2);
}

/** The points strictly between two instants; `points` is sorted by time (binary search). */
function between(points: readonly StayPoint[], afterMs: number, beforeMs: number): StayPoint[] {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timestampMs <= afterMs) lo = mid + 1;
    else hi = mid;
  }
  const out: StayPoint[] = [];
  for (let i = lo; i < points.length && points[i].timestampMs < beforeMs; i++) out.push(points[i]);
  return out;
}

function candidateOf({ points: group, skipped }: Group, truncated: boolean): StayCandidate {
  // A reduce, not Math.max(...gaps): a month at home logged every few
  // seconds is several hundred thousand points and overflowed the stack.
  const maxGapMinutes = group
    .slice(1)
    .reduce((max, p, i) => Math.max(max, (p.timestampMs - group[i].timestampMs) / 60_000), 0);
  return {
    startAt: new Date(group[0].timestampMs),
    endAt: new Date(group.at(-1)!.timestampMs),
    ...centre(group),
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
  };
}

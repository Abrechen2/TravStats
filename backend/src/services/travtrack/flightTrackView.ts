import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import type { ZoneCircle } from "./classify";
import { privacyCirclesFor } from "./privacyCircles";
import { privacyCutBy, type LonLat } from "./privacyCut";

/**
 * The ONE way a stored flight recording reaches anybody (TravTrack plan T5,
 * security review): the flight page, the map's track lines, a public share
 * link's last position and the encrypted share all read the line through
 * here, privacy-cut with the owner's circles in force for it — every zone,
 * and every former zone's circle that still covers a line begun before it
 * went. Nothing inside a circle and no chord through one ever leaves.
 *
 * And nothing ABOUT the hidden part leaves either: once the cut removed a
 * vertex, every figure describes what is left — `distanceKm` from the kept
 * stretches, `pointCount` the kept vertices, the altitude profile trimmed to
 * the kept distance ranges (dropped without `cumulativeKm` to place it), and
 * a cut end has no time (`startCut` / `endCut`): the line holds no
 * per-vertex times, so the time of the vertex that is now last is not known.
 */

export type FlightTrackLine = {
  geometry: unknown;
  segmentStarts: unknown;
  cumulativeKm?: unknown;
  distanceKm?: number;
  pointCount?: number;
  elevations?: unknown;
  startedAt: Date;
};

export type ViewableTrack<T> = {
  track: T;
  /** The cut removed the first vertex: `startedAt` describes a hidden point. */
  startCut: boolean;
  /** The cut removed the last vertex: `endedAt` describes a hidden point. */
  endCut: boolean;
};

const asLine = (value: unknown): LonLat[] =>
  Array.isArray(value)
    ? value.filter(
        (p): p is LonLat => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      )
    : [];
const asStarts = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : [0];
const asNumbers = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((n) => typeof n === "number") ? (value as number[]) : null;

type Kept = Array<Array<{ p: LonLat; i: number }>>;

/** The kept stretches' length: by the recording's own running distance, else on the sphere. */
function keptKm(kept: Kept, cumulative: number[] | null): number {
  let km = 0;
  for (const line of kept) {
    const first = line[0];
    const last = line[line.length - 1];
    if (cumulative && cumulative[first.i] !== undefined && cumulative[last.i] !== undefined) {
      km += cumulative[last.i] - cumulative[first.i];
      continue;
    }
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1].p, line[k].p];
      km += haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
    }
  }
  return Math.round(km * 1000) / 1000;
}

/** The altitude profile within the kept distance ranges; null where it cannot be placed. */
function keptElevations(elevations: unknown, kept: Kept, cumulative: number[] | null) {
  if (!Array.isArray(elevations)) return elevations ?? null;
  if (!cumulative) return null;
  const ranges = kept.map((line) => [cumulative[line[0].i], cumulative[line[line.length - 1].i]]);
  return elevations.filter(
    (e) =>
      Array.isArray(e) &&
      typeof e[0] === "number" &&
      ranges.some(([from, to]) => e[0] >= from && e[0] <= to)
  );
}

/** The line cut with `circles`, and every figure describing only what is left. */
export function cutFlightTrackWith<T extends FlightTrackLine>(
  track: T,
  circles: readonly ZoneCircle[]
): ViewableTrack<T> {
  const geometry = asLine(track.geometry);
  if (circles.length === 0) return { track, startCut: false, endCut: false };
  const cumulative = asNumbers(track.cumulativeKm);
  const starts = [...new Set([0, ...asStarts(track.segmentStarts)])]
    .filter((i) => i < geometry.length)
    .sort((a, b) => a - b);
  const lines = starts.map((start, k) =>
    geometry.slice(start, starts[k + 1] ?? geometry.length).map((p, j) => ({ p, i: start + j }))
  );
  const kept: Kept = privacyCutBy(lines, circles, (v) => v.p);
  const keptCount = kept.reduce((n, line) => n + line.length, 0);
  if (keptCount === geometry.length) return { track, startCut: false, endCut: false };

  const out: LonLat[] = [];
  const outStarts: number[] = [];
  const outKm: number[] = [];
  for (const line of kept) {
    outStarts.push(out.length);
    for (const v of line) {
      out.push(v.p);
      if (cumulative) outKm.push(cumulative[v.i]);
    }
  }
  const firstKept = kept[0]?.[0]?.i;
  const lastLine = kept[kept.length - 1];
  const lastKept = lastLine?.[lastLine.length - 1]?.i;
  return {
    track: {
      ...track,
      geometry: out,
      segmentStarts: out.length > 0 ? outStarts : [],
      ...(cumulative ? { cumulativeKm: outKm } : {}),
      ...("distanceKm" in track ? { distanceKm: keptKm(kept, cumulative) } : {}),
      ...("pointCount" in track ? { pointCount: keptCount } : {}),
      ...("elevations" in track
        ? { elevations: keptElevations(track.elevations, kept, cumulative) }
        : {}),
    },
    startCut: firstKept !== 0,
    endCut: lastKept !== geometry.length - 1,
  };
}

/** A stored line as the owner's circles allow it to be shown. */
export async function viewableFlightTrack<T extends FlightTrackLine>(
  userId: string,
  track: T
): Promise<ViewableTrack<T>> {
  return cutFlightTrackWith(track, await privacyCirclesFor(userId, track.startedAt.getTime()));
}

/**
 * The last recorded position a viewer may see, or null when the cut leaves
 * none. Its time only when it IS the recording's last fix; otherwise the
 * time of the vertex now last is not known, and none is given.
 */
export async function lastViewablePosition(
  userId: string,
  flightId: string
): Promise<{ lat: number; lon: number; recordedAt: string | null } | null> {
  const track = await prisma.flightTrack.findUnique({
    where: { flightId },
    select: { geometry: true, segmentStarts: true, startedAt: true, endedAt: true },
  });
  if (!track) return null;
  const { track: cut, endCut } = await viewableFlightTrack(userId, track);
  const line = asLine(cut.geometry);
  const last = line[line.length - 1];
  if (!last) return null;
  return { lat: last[1], lon: last[0], recordedAt: endCut ? null : track.endedAt.toISOString() };
}

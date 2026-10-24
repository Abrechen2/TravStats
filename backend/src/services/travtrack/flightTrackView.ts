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
 * And nothing ABOUT the hidden part leaves either: once the cut changed the
 * line — a vertex removed, or a stretch broken where a chord crossed a zone —
 * every figure describes what is left. `cumulativeKm` is rebased onto the
 * kept stretches (each starts where the one before ended), `distanceKm` is
 * their sum, `pointCount` the kept vertices, the altitude profile keeps only
 * the kept stretches with its distances rebased the same way (dropped without
 * a running distance to place it), and a cut end has no time (`startCut` /
 * `endCut`): the line holds no per-vertex times, so the time of the vertex
 * that is now last is not known.
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

/** The kept stretches' length on the sphere, for a line without a running distance. */
function sphereKm(kept: Kept): number {
  let km = 0;
  for (const line of kept) {
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1].p, line[k].p];
      km += haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
    }
  }
  return km;
}

const round = (km: number) => Math.round(km * 1000) / 1000;

/**
 * The running distance rebased onto the kept stretches: each kept line starts
 * where the one before ended, so no figure counts the distance through a hidden
 * part or across a broken chord. `offsets[k]` maps the original running
 * distance inside kept line k onto the rebased one.
 */
function rebase(kept: Kept, cumulative: number[]) {
  const offsets: Array<{ from: number; to: number; shift: number }> = [];
  const km: number[] = [];
  let acc = 0;
  for (const line of kept) {
    const from = cumulative[line[0].i];
    const to = cumulative[line[line.length - 1].i];
    offsets.push({ from, to, shift: acc - from });
    for (const v of line) km.push(round(cumulative[v.i] + acc - from));
    acc += to - from;
  }
  return { km, offsets, total: round(acc) };
}

/** The altitude profile within the kept stretches, its distances rebased with them. */
function keptElevations(
  elevations: unknown,
  offsets: ReturnType<typeof rebase>["offsets"] | null
): unknown {
  if (!Array.isArray(elevations)) return elevations ?? null;
  if (!offsets) return null;
  return elevations.flatMap((e) => {
    if (!Array.isArray(e) || typeof e[0] !== "number") return [];
    const range = offsets.find((o) => e[0] >= o.from && e[0] <= o.to);
    return range ? [[round(e[0] + range.shift), e[1]]] : [];
  });
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
  // Unchanged only when every vertex stayed AND the pieces are the original
  // stretches: a chord through a zone breaks a stretch without removing a vertex.
  const sameShape =
    keptCount === geometry.length &&
    kept.length === lines.length &&
    kept.every((line, k) => line[0].i === starts[k]);
  if (sameShape) return { track, startCut: false, endCut: false };

  const out: LonLat[] = [];
  const outStarts: number[] = [];
  for (const line of kept) {
    outStarts.push(out.length);
    for (const v of line) out.push(v.p);
  }
  const usable = cumulative && cumulative.length === geometry.length ? cumulative : null;
  const based = usable ? rebase(kept, usable) : null;
  const firstKept = kept[0]?.[0]?.i;
  const lastLine = kept[kept.length - 1];
  const lastKept = lastLine?.[lastLine.length - 1]?.i;
  return {
    track: {
      ...track,
      geometry: out,
      segmentStarts: out.length > 0 ? outStarts : [],
      ...(cumulative ? { cumulativeKm: based ? based.km : null } : {}),
      ...("distanceKm" in track ? { distanceKm: based ? based.total : round(sphereKm(kept)) } : {}),
      ...("pointCount" in track ? { pointCount: keptCount } : {}),
      ...("elevations" in track
        ? { elevations: keptElevations(track.elevations, based?.offsets ?? null) }
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

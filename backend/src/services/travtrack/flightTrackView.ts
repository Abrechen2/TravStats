import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import type { ZoneCircle } from "./classify";
import { privacyCirclesFor } from "./privacyCircles";
import { privacyCutBy, segmentCrossesZone, type LonLat } from "./privacyCut";

/**
 * The ONE way a stored flight recording reaches anybody (TravTrack plan T5,
 * security review): the flight page, the map's track lines, a public share
 * link's last position and the encrypted share all read the line through
 * here, privacy-cut with the owner's circles in force for it — every zone,
 * and every former zone's circle that still covers a line begun before it
 * went. Nothing inside a circle and no chord through one ever leaves.
 *
 * And nothing ABOUT the hidden part leaves either. A stored line is
 * simplified and its raw fixes are gone, so whether a figure's basis held a
 * fix inside a circle can only be bounded: a line farther than
 * `FIGURE_TRUST_MARGIN_M` from every circle is served as stored; any other is
 * rebuilt from its kept geometry — the running distance re-measured on the
 * chords near a circle (each kept stretch starting where the one before
 * ended), `distanceKm` its total, `pointCount` the kept vertices, the
 * altitude profile only on trusted chords, no jitter count, and an end that
 * was cut or lies near a circle without its time (`startCut` / `endCut`).
 * A line built from a provider's fixes is cut BEFORE it is measured
 * (`providerFlightColumns.ts`) and checked here once more.
 */

export type FlightTrackLine = {
  geometry: unknown;
  segmentStarts: unknown;
  cumulativeKm?: unknown;
  distanceKm?: number;
  pointCount?: number;
  elevations?: unknown;
  jitterDropped?: number | null;
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

/**
 * How near a zone a stored line may pass before its figures are no longer
 * trusted. A stored line is simplified and its raw fixes are gone; a fix
 * simplification dropped lay within the simplification tolerance of a kept
 * chord — 11 m at the start, raised only while a long recording exceeds its
 * vertex cap. 5 km is far beyond that, so a chord farther than this from every
 * circle provably had no fix inside one, and its stored running distance,
 * altitude profile and end times are kept; nearer, they are measured again on
 * the kept geometry or left out.
 */
export const FIGURE_TRUST_MARGIN_M = 5000;

const near = (a: LonLat, b: LonLat, circles: readonly ZoneCircle[]) =>
  circles.some((c) =>
    segmentCrossesZone(a, b, { ...c, radiusM: c.radiusM + FIGURE_TRUST_MARGIN_M })
  );

const round = (km: number) => Math.round(km * 1000) / 1000;

const stepKm = (a: LonLat, b: LonLat) =>
  haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });

/**
 * The running distance over the kept stretches, each starting where the one
 * before ended. A chord far from every circle keeps its stored raw distance
 * (exact, AUD-034); a chord near one, or a line without a running distance,
 * is measured on the sphere. `ranges` place the altitude profile: the stored
 * distance range of each trusted chord and how far it moved.
 */
function remeasure(kept: Kept, circles: readonly ZoneCircle[], cumulative: number[] | null) {
  const km: number[] = [];
  const ranges: Array<{ from: number; to: number; shift: number }> = [];
  let acc = 0;
  for (const line of kept) {
    km.push(round(acc));
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1], line[k]];
      const trusted = cumulative !== null && !near(a.p, b.p, circles);
      const step = trusted ? cumulative[b.i] - cumulative[a.i] : stepKm(a.p, b.p);
      if (trusted)
        ranges.push({ from: cumulative[a.i], to: cumulative[b.i], shift: acc - cumulative[a.i] });
      acc += step;
      km.push(round(acc));
    }
  }
  return { km, ranges, total: round(acc) };
}

/** The altitude profile on the trusted chords only, its distances moved with them. */
function keptElevations(
  elevations: unknown,
  ranges: ReturnType<typeof remeasure>["ranges"] | null
): unknown {
  if (!Array.isArray(elevations)) return elevations ?? null;
  if (!ranges) return null;
  const kept = elevations.flatMap((e) => {
    if (!Array.isArray(e) || typeof e[0] !== "number") return [];
    const range = ranges.find((r) => e[0] >= r.from && e[0] <= r.to);
    return range ? [[round(e[0] + range.shift), e[1]]] : [];
  });
  // Two chords meeting at a vertex both hold the vertex's sample: keep it once.
  const unique = kept.filter(
    (e, k) => k === 0 || e[0] !== kept[k - 1][0] || e[1] !== kept[k - 1][1]
  );
  return unique.length > 0 ? unique : null;
}

/**
 * The line cut with `circles`, and every figure describing only what is left.
 * A line far from every circle is returned as it is; any other is rebuilt:
 * the kept pieces, the running distance re-measured where its basis may have
 * held a hidden fix, the vertex count of what is drawn, no jitter count (its
 * basis held the hidden part), and an end near a circle without its time.
 */
export function cutFlightTrackWith<T extends FlightTrackLine>(
  track: T,
  circles: readonly ZoneCircle[]
): ViewableTrack<T> {
  const geometry = asLine(track.geometry);
  if (circles.length === 0 || geometry.length === 0) {
    return { track, startCut: false, endCut: false };
  }
  const cumulative = asNumbers(track.cumulativeKm);
  const starts = [...new Set([0, ...asStarts(track.segmentStarts)])]
    .filter((i) => i < geometry.length)
    .sort((a, b) => a - b);
  const lines = starts.map((start, k) =>
    geometry.slice(start, starts[k + 1] ?? geometry.length).map((p, j) => ({ p, i: start + j }))
  );
  const anyNear = lines.some((line) =>
    line.some((v, k) => near(line[k - 1]?.p ?? v.p, v.p, circles))
  );
  if (!anyNear) return { track, startCut: false, endCut: false };

  const kept: Kept = privacyCutBy(lines, circles, (v) => v.p);
  const keptCount = kept.reduce((n, line) => n + line.length, 0);
  const out: LonLat[] = [];
  const outStarts: number[] = [];
  for (const line of kept) {
    outStarts.push(out.length);
    for (const v of line) out.push(v.p);
  }
  const usable = cumulative && cumulative.length === geometry.length ? cumulative : null;
  const measured = remeasure(kept, circles, usable);
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  return {
    track: {
      ...track,
      geometry: out,
      segmentStarts: out.length > 0 ? outStarts : [],
      ...(cumulative ? { cumulativeKm: out.length > 0 ? measured.km : null } : {}),
      ...("distanceKm" in track ? { distanceKm: measured.total } : {}),
      ...("pointCount" in track ? { pointCount: keptCount } : {}),
      ...("jitterDropped" in track ? { jitterDropped: null } : {}),
      ...("elevations" in track
        ? { elevations: keptElevations(track.elevations, usable ? measured.ranges : null) }
        : {}),
    },
    // The time of a hidden vertex, or of one beside a circle, is not given.
    startCut: kept[0]?.[0]?.i !== 0 || near(first, first, circles),
    endCut:
      kept[kept.length - 1]?.[kept[kept.length - 1].length - 1]?.i !== geometry.length - 1 ||
      near(last, last, circles),
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

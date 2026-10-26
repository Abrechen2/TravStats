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
 * And nothing ABOUT the hidden part leaves either. A stored line is jitter
 * filtered and simplified and its raw fixes are gone, so no distance from a
 * circle proves that a figure's basis held no fix inside one: the filter can
 * fold a fix arbitrarily far away into a stay, and simplification raises its
 * tolerance without bound while a long recording exceeds its vertex cap
 * (Codex, P1 — a 5 km "trust margin" stood here and proved nothing). So the
 * rule is all or nothing: with no circle in force the stored figures are
 * served unchanged; with ANY circle in force every figure is derived from the
 * line as shown — the distance on the kept chords, `pointCount` the shown
 * vertices, no jitter count, the altitude profile only at the shown vertices, and an
 * end's time only where the shown end is provably the recorded end
 * (`startCut` / `endCut`). A line built from a provider's fixes is cut BEFORE
 * it is measured (`providerFlightColumns.ts`) and comes through here as well.
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
  /** `startedAt` may describe a point not shown: the first shown vertex is not provably the recorded first. */
  startCut: boolean;
  /** `endedAt` may describe a point not shown: the last shown vertex is not provably the recorded last. */
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

const round = (km: number) => Math.round(km * 1000) / 1000;

const stepKm = (a: LonLat, b: LonLat) =>
  haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });

/** A shown vertex: its stored running distance and where it sits on the shown line. */
type ShownVertex = { stored: number; at: number };

/**
 * The running distance over the shown line, measured on its own chords, each
 * kept stretch starting where the one before ended. `vertices` place the
 * altitude profile.
 */
function measureShown(kept: Kept, cumulative: number[] | null) {
  const km: number[] = [];
  const vertices: ShownVertex[] = [];
  let acc = 0;
  for (const line of kept) {
    for (let k = 0; k < line.length; k++) {
      if (k > 0) acc += stepKm(line[k - 1].p, line[k].p);
      km.push(round(acc));
      if (cumulative) vertices.push({ stored: cumulative[line[k].i], at: round(acc) });
    }
  }
  return { km, vertices, total: round(acc) };
}

/** Stored profile positions are rounded to the metre (`elevationProfile`). */
const sameKm = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/**
 * The altitude profile at the shown vertices only. A vertex is a recorded fix
 * the viewer sees, so its sample describes nothing hidden; a sample between
 * two vertices may come from a fix simplification or the jitter filter took
 * out — one inside a zone among them (security review) — and goes, however
 * near or far the zone. A stored position shared with a vertex that is NOT
 * shown (a segment boundary carries one running distance for two vertices)
 * goes too. Without a running distance no sample can be placed, and the
 * profile is left out.
 */
function shownElevations(
  elevations: unknown,
  vertices: readonly ShownVertex[] | null,
  hidden: readonly number[]
): unknown {
  if (!Array.isArray(elevations)) return elevations ?? null;
  if (!vertices) return null;
  const kept = elevations.flatMap((e) => {
    if (!Array.isArray(e) || typeof e[0] !== "number") return [];
    if (hidden.some((km) => sameKm(km, e[0]))) return [];
    const vertex = vertices.find((v) => sameKm(v.stored, e[0]));
    return vertex ? [[vertex.at, e[1]]] : [];
  });
  // Two shown vertices at one stored position both match its sample: keep it once.
  const unique = kept.filter(
    (e, k) => k === 0 || e[0] !== kept[k - 1][0] || e[1] !== kept[k - 1][1]
  );
  return unique.length > 0 ? unique : null;
}

/** The stored running distances of the vertices the cut did not keep. */
function hiddenKm(cumulative: readonly number[], kept: Kept): number[] {
  const shown = new Set(kept.flatMap((line) => line.map((v) => v.i)));
  return cumulative.filter((_, i) => !shown.has(i));
}

/**
 * Whether the stored line's ends are the recorded ends. Simplification keeps
 * every segment's ends, so only the jitter filter can replace one (a stay
 * becomes its middle, a coarse first fix is dropped): with nothing filtered
 * (`0`) or the line never checked (`null`) they are; an unknown count proves
 * nothing.
 */
const endsAreRecorded = (track: FlightTrackLine) =>
  track.jitterDropped === 0 || track.jitterDropped === null;

/**
 * The line cut with `circles`, and every figure describing only what is
 * shown. With no circle the line is returned as it is; with any, it is
 * rebuilt from its kept geometry (see the module comment).
 */
export function cutFlightTrackWith<T extends FlightTrackLine>(
  track: T,
  circles: readonly ZoneCircle[]
): ViewableTrack<T> {
  if (circles.length === 0) return { track, startCut: false, endCut: false };
  const geometry = asLine(track.geometry);
  const cumulative = asNumbers(track.cumulativeKm);
  const starts = [...new Set([0, ...asStarts(track.segmentStarts)])]
    .filter((i) => i < geometry.length)
    .sort((a, b) => a - b);
  const lines = starts.map((start, k) =>
    geometry.slice(start, starts[k + 1] ?? geometry.length).map((p, j) => ({ p, i: start + j }))
  );

  const kept: Kept = privacyCutBy(lines, circles, (v) => v.p);
  const out: LonLat[] = [];
  const outStarts: number[] = [];
  for (const line of kept) {
    outStarts.push(out.length);
    for (const v of line) out.push(v.p);
  }
  const usable = cumulative && cumulative.length === geometry.length ? cumulative : null;
  const measured = measureShown(kept, usable);
  const firstShown = kept[0]?.[0]?.i;
  const lastLine = kept[kept.length - 1];
  const lastShown = lastLine?.[lastLine.length - 1]?.i;
  const recorded = endsAreRecorded(track);
  return {
    track: {
      ...track,
      geometry: out,
      segmentStarts: out.length > 0 ? outStarts : [],
      ...(cumulative ? { cumulativeKm: out.length > 0 ? measured.km : null } : {}),
      ...("distanceKm" in track ? { distanceKm: measured.total } : {}),
      ...("pointCount" in track ? { pointCount: out.length } : {}),
      ...("jitterDropped" in track ? { jitterDropped: null } : {}),
      ...("elevations" in track
        ? {
            elevations: shownElevations(
              track.elevations,
              usable ? measured.vertices : null,
              usable ? hiddenKm(usable, kept) : []
            ),
          }
        : {}),
    },
    // An end's time only where the shown end is the recorded one.
    startCut: !(recorded && firstShown === 0),
    endCut: !(recorded && lastShown !== undefined && lastShown === geometry.length - 1),
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
    select: {
      geometry: true,
      segmentStarts: true,
      startedAt: true,
      endedAt: true,
      jitterDropped: true,
    },
  });
  if (!track) return null;
  const { track: cut, endCut } = await viewableFlightTrack(userId, track);
  const line = asLine(cut.geometry);
  const last = line[line.length - 1];
  if (!last) return null;
  return { lat: last[1], lon: last[0], recordedAt: endCut ? null : track.endedAt.toISOString() };
}

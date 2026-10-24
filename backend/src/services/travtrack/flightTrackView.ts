import { prisma } from "../../db";
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
 * `cumulativeKm` runs per vertex of `geometry`, so it is cut with it; the
 * altitude profile is keyed by distance, not by vertex, and carries no
 * position.
 */

export type FlightTrackLine = {
  geometry: unknown;
  segmentStarts: unknown;
  cumulativeKm?: unknown;
  startedAt: Date;
};

const asLine = (value: unknown): LonLat[] =>
  Array.isArray(value)
    ? value.filter(
        (p): p is LonLat => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      )
    : [];
const asStarts = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : [0];

/** The line cut with `circles`; `geometry` empty when nothing is left. */
export function cutFlightTrackWith<T extends FlightTrackLine>(
  track: T,
  circles: readonly ZoneCircle[]
): T {
  if (circles.length === 0) return track;
  const geometry = asLine(track.geometry);
  const cumulative = Array.isArray(track.cumulativeKm) ? (track.cumulativeKm as unknown[]) : null;
  const starts = [...new Set([0, ...asStarts(track.segmentStarts)])]
    .filter((i) => i < geometry.length)
    .sort((a, b) => a - b);
  const lines = starts.map((start, k) =>
    geometry.slice(start, starts[k + 1] ?? geometry.length).map((p, j) => ({ p, i: start + j }))
  );
  const cut = privacyCutBy(lines, circles, (v) => v.p);
  const out: LonLat[] = [];
  const outStarts: number[] = [];
  const outKm: unknown[] = [];
  for (const line of cut) {
    outStarts.push(out.length);
    for (const v of line) {
      out.push(v.p);
      if (cumulative) outKm.push(cumulative[v.i]);
    }
  }
  return {
    ...track,
    geometry: out,
    segmentStarts: out.length > 0 ? outStarts : [],
    ...(cumulative ? { cumulativeKm: outKm } : {}),
  };
}

/** A stored line as the owner's circles allow it to be shown. */
export async function viewableFlightTrack<T extends FlightTrackLine>(
  userId: string,
  track: T
): Promise<T> {
  return cutFlightTrackWith(track, await privacyCirclesFor(userId, track.startedAt.getTime()));
}

/** The last recorded position a viewer may see, or null when the cut leaves none. */
export async function lastViewablePosition(
  userId: string,
  flightId: string
): Promise<{ lat: number; lon: number; recordedAt: string } | null> {
  const track = await prisma.flightTrack.findUnique({
    where: { flightId },
    select: { geometry: true, segmentStarts: true, startedAt: true, endedAt: true },
  });
  if (!track) return null;
  const cut = await viewableFlightTrack(userId, track);
  const line = asLine(cut.geometry);
  const last = line[line.length - 1];
  if (!last) return null;
  return { lat: last[1], lon: last[0], recordedAt: track.endedAt.toISOString() };
}

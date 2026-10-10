import type { InsightLeg, InsightStation } from "./types";

/** What grouping needs of a station: its id, and whether it is a route correction. */
export interface SegmentStation {
  id: string;
  viaPoint: boolean;
}

/** What grouping needs of a leg: its two ends and its length. */
export interface SegmentLeg {
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
}

/** The way from one real station to the next, through any route corrections. */
export interface Segment<
  S extends SegmentStation = InsightStation,
  L extends SegmentLeg = InsightLeg,
> {
  from: S;
  to: S;
  legs: L[];
  km: number;
}

/**
 * Legs grouped into the stretches between real stations. A route correction
 * (`viaPoint`) bends the line and carries no date of its own, so a leg ending
 * at one is not a stage: A → correction → B is ONE day's drive from A to B,
 * dated by A and B. Without this every corrected route would fall out of the
 * day stages for lack of a date at the bend.
 */
export function segmentsOf<S extends SegmentStation, L extends SegmentLeg>(
  stations: readonly S[],
  legs: readonly L[]
): Segment<S, L>[] {
  const position = new Map(stations.map((s, i) => [s.id, i]));
  const byId = new Map(stations.map((s) => [s.id, s]));
  const ordered = legs
    .filter((l) => position.has(l.fromStopId) && position.has(l.toStopId))
    .sort(
      (a, b) => (position.get(a.fromStopId) as number) - (position.get(b.fromStopId) as number)
    );

  const segments: Segment<S, L>[] = [];
  let open: { from: S; legs: L[] } | null = null;
  for (const leg of ordered) {
    const from = byId.get(leg.fromStopId) as S;
    const to = byId.get(leg.toStopId) as S;
    if (!open || !from.viaPoint) open = { from, legs: [] };
    open.legs.push(leg);
    if (!to.viaPoint) {
      segments.push({ ...open, to, km: open.legs.reduce((s, l) => s + l.distanceKm, 0) });
      open = null;
    }
  }
  // A route that ends on a correction still drove those kilometres.
  if (open) {
    const last = open.legs[open.legs.length - 1];
    segments.push({
      ...open,
      to: byId.get(last.toStopId) as S,
      km: open.legs.reduce((s, l) => s + l.distanceKm, 0),
    });
  }
  return segments;
}

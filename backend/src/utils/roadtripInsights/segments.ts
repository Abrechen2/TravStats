import type { InsightLeg, InsightStation } from "./types";

/** The way from one real station to the next, through any route corrections. */
export interface Segment {
  from: InsightStation;
  to: InsightStation;
  legs: InsightLeg[];
  km: number;
}

/**
 * Legs grouped into the stretches between real stations. A route correction
 * (`viaPoint`) bends the line and carries no date of its own, so a leg ending
 * at one is not a stage: A → correction → B is ONE day's drive from A to B,
 * dated by A and B. Without this every corrected route would fall out of the
 * day stages for lack of a date at the bend.
 */
export function segmentsOf(
  stations: readonly InsightStation[],
  legs: readonly InsightLeg[]
): Segment[] {
  const position = new Map(stations.map((s, i) => [s.id, i]));
  const byId = new Map(stations.map((s) => [s.id, s]));
  const ordered = legs
    .filter((l) => position.has(l.fromStopId) && position.has(l.toStopId))
    .sort(
      (a, b) => (position.get(a.fromStopId) as number) - (position.get(b.fromStopId) as number)
    );

  const segments: Segment[] = [];
  let open: { from: InsightStation; legs: InsightLeg[] } | null = null;
  for (const leg of ordered) {
    const from = byId.get(leg.fromStopId) as InsightStation;
    const to = byId.get(leg.toStopId) as InsightStation;
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
      to: byId.get(last.toStopId) as InsightStation,
      km: open.legs.reduce((s, l) => s + l.distanceKm, 0),
    });
  }
  return segments;
}

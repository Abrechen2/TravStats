/** Pure rules for changing a station's nights by one. No React, no network. */
import type { PlanState } from "../../../lib/api/travplan";

export interface FixedDate {
  title: string;
  day: string;
}

/**
 * What follows a station and cannot move with it: a later station pinned to a day, and a later
 * leg whose booking is real (a placeholder moves; a ticket does not). One more night here pushes
 * the route towards these; the server then reports the conflict, this list warns before.
 */
export function fixedAfter(state: PlanState, stationId: string): FixedDate[] {
  const at = state.stations.findIndex((s) => s.id === stationId);
  if (at === -1) return [];
  const later = state.stations.slice(at + 1);
  const ids = new Set([stationId, ...later.map((s) => s.id)]);
  const pinned = later.flatMap((s) => (s.pinnedDay ? [{ title: s.title, day: s.pinnedDay }] : []));
  const booked = state.stages
    .filter((g) => ids.has(g.fromStationId) && ids.has(g.toStationId) && g.bookingId)
    .flatMap((g) => {
      const b = state.bookings.find((x) => x.id === g.bookingId);
      return b && !b.placeholder && b.day ? [{ title: b.title, day: b.day }] : [];
    });
  return [...pinned, ...booked].sort((a, b) => a.day.localeCompare(b.day));
}

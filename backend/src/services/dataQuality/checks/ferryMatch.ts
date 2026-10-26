import type { RecordSnapshot } from "../recordGather";
import type { DataQualityFinding } from "../types";
import { isSetAside } from "./setAside";

/**
 * A ferry ride on no trip whose crossing lies inside one trip's days (spec
 * 2026-10-25 C3, the contract's `ferryMatch`) — "belongs this crossing to
 * your trip X?", answered with `link`.
 *
 * Trip suggestions (`services/tripSuggestions`) propose links for flights,
 * rail, cruises, stays, places and roadtrips, never for ferries; a crossing
 * typed in on its own therefore sat outside every trip with nobody asking.
 *
 * Conservative, like every check: a question about the wrong trip invites a
 * wrong link.
 * - Both the departure and the arrival day (each on its own port's clock)
 *   must lie inside the trip's first and last day. A trip without both days
 *   is not a window.
 * - EXACTLY one trip may qualify. Two overlapping trips are a choice the
 *   check cannot make, so it asks nothing.
 * - A cancelled ride or trip is never asked about, nor a ride linked to a
 *   roadtrip leg — its trip follows the roadtrip.
 */
export function findFerryMatches(
  snapshot: Pick<RecordSnapshot, "ferryJourneys" | "trips">
): DataQualityFinding[] {
  const windows = snapshot.trips.filter(
    (t) => !isSetAside(t.status) && t.startDay !== null && t.endDay !== null
  );
  const out: DataQualityFinding[] = [];
  for (const ride of snapshot.ferryJourneys) {
    if (ride.tripId || ride.onRoadtrip || isSetAside(ride.status)) continue;
    const { firstDay, lastDay } = ride;
    if (!firstDay || !lastDay) continue;
    const inside = windows.filter(
      (t) => (t.startDay as string) <= firstDay && lastDay <= (t.endDay as string)
    );
    if (inside.length !== 1) continue;
    const [trip] = inside;
    out.push({
      entityType: "ferry_journey",
      entityId: ride.id,
      kind: "ferry_match",
      details: {
        ferryId: ride.id,
        candidateTripId: trip.id,
        candidateTripName: trip.name,
        departurePort: ride.depName || null,
        arrivalPort: ride.arrName || null,
        departureTime: ride.departure,
        reason: "insideTripWindow",
      },
    });
  }
  return out;
}

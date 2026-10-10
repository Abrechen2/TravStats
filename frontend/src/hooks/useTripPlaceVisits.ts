import { useEffect, useState } from "react";

import { listPlaces } from "../lib/api/places";
import { logger } from "../lib/logger";
import type { Place, PlaceVisit } from "../types/place";

/**
 * Places visited on a trip, with the visit that ties each to it. A place is a
 * first-class row of its own, so the trip READS it rather than owning it —
 * which is what #177 asked for. Moved out of `pages/TripDetailPage.tsx`
 * (frozen at its size) when notes joined the timeline.
 *
 * Places are their own domain, so they are fetched separately rather than
 * embedded in the trip payload. A failure here must not blank the trip: the
 * timeline simply shows no places, which is what it did before they existed.
 */
export function useTripPlaceVisits(
  tripId: string,
  enabled: boolean
): { place: Place; visit: PlaceVisit }[] {
  const [placeVisits, setPlaceVisits] = useState<{ place: Place; visit: PlaceVisit }[]>([]);

  useEffect(() => {
    if (!tripId || !enabled) {
      setPlaceVisits([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const places = await listPlaces({ tripId });
        if (cancelled) return;
        setPlaceVisits(
          places.flatMap((place) =>
            place.visits.filter((v) => v.tripId === tripId).map((visit) => ({ place, visit }))
          )
        );
      } catch (err: unknown) {
        logger.error({ err }, "TripDetailPage: failed to load place visits");
        if (!cancelled) setPlaceVisits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);

  return placeVisits;
}

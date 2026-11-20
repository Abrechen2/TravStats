import { useCallback, useEffect, useState } from "react";

import { listPlaces } from "../lib/api/places";
import { logger } from "../lib/logger";
import type { Place, PlaceVisit } from "../types/place";

export interface TripPlaceVisit {
  place: Place;
  visit: PlaceVisit;
}

const NO_VISITS: TripPlaceVisit[] = [];

export interface TripPlaceVisits {
  placeVisits: TripPlaceVisit[];
  /** The load failed — the list is empty because it is UNKNOWN, not because the trip has none. */
  failed: boolean;
  /** The first answer for this trip is still on its way. */
  loading: boolean;
  /** Try the load again (the trip's "Erneut versuchen"). */
  reload: () => void;
}

interface Settled {
  key: string;
  placeVisits: TripPlaceVisit[];
  failed: boolean;
}

/**
 * Places visited on a trip, with the visit that ties each to it. A place is a
 * first-class row of its own, so the trip READS it rather than owning it —
 * which is what #177 asked for. Moved out of `pages/TripDetailPage.tsx`
 * (frozen at its size) when notes joined the timeline.
 *
 * Places are their own domain, so they are fetched separately rather than
 * embedded in the trip payload. A failure here must not blank the trip, but it
 * must not pass for "no places" either: it used to log and hand back an empty
 * list, so a trip whose places failed to load looked like a trip without any
 * (owner rule "every error is visible", 2026-11-18). `failed` lets the page
 * say so and offer `reload`.
 *
 * One call per trip page: the timeline, the map, the head count and the error
 * line all read the same result instead of each fetching its own.
 */
export function useTripPlaceVisits(tripId: string, enabled: boolean): TripPlaceVisits {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const active = Boolean(tripId) && enabled;
  // An answer belongs to the trip (and attempt) it was asked for: moving to
  // another trip must not show the previous trip's places while it loads.
  const key = `${tripId}#${attempt}`;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const places = await listPlaces({ tripId });
        if (cancelled) return;
        setSettled({
          key,
          failed: false,
          placeVisits: places.flatMap((place) =>
            place.visits.filter((v) => v.tripId === tripId).map((visit) => ({ place, visit }))
          ),
        });
      } catch (err: unknown) {
        if (cancelled) return;
        logger.warn("Failed to load the places of trip", { tripId, err });
        setSettled({ key, failed: true, placeVisits: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, active, key]);

  const current = active && settled?.key === key ? settled : null;
  return {
    placeVisits: current?.placeVisits ?? NO_VISITS,
    failed: current?.failed ?? false,
    loading: active && current === null,
    reload,
  };
}

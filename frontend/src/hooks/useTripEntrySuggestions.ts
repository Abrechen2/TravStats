import { useEffect, useState } from "react";

import { tripsApi, type TripEntrySuggestions } from "../lib/api/trips";
import { logger } from "../lib/logger";

export const NO_TRIP_ENTRY_SUGGESTIONS: TripEntrySuggestions = { origins: [], destinations: [] };

/**
 * What the trip form can offer for its origin and destination labels: the
 * home airport, and — for a trip that already exists — where its entries went.
 *
 * Asked once per opened form. A failed request is not the user's problem: the
 * labels are free text and work without suggestions.
 */
export function useTripEntrySuggestions(tripId: string | null): TripEntrySuggestions {
  const [suggestions, setSuggestions] = useState<TripEntrySuggestions>(NO_TRIP_ENTRY_SUGGESTIONS);

  useEffect(() => {
    let active = true;
    tripsApi
      .getEntrySuggestions(tripId ?? undefined)
      .then((next) => {
        if (active) setSuggestions(next);
      })
      .catch((error: unknown) => {
        logger.warn("Trip entry suggestions failed", { error });
        if (active) setSuggestions(NO_TRIP_ENTRY_SUGGESTIONS);
      });
    return () => {
      active = false;
    };
  }, [tripId]);

  return suggestions;
}

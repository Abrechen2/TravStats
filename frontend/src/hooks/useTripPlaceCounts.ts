import { useCallback, useEffect, useState } from "react";

import { listPlaces } from "../lib/api/places";
import { logger } from "../lib/logger";
import { countPlacesByTrip } from "../lib/tripPlaceCount";

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * "N Orte" for every trip of the list: one read of the user's places, grouped
 * by the trip each visit belongs to. A failed read is reported (`failed`) and
 * retryable rather than passed off as "no trip has places".
 */
export function useTripPlaceCounts(enabled: boolean): {
  counts: ReadonlyMap<string, number>;
  failed: boolean;
  reload: () => void;
} {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(NO_COUNTS);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    setFailed(false);
    if (!enabled) {
      setCounts(NO_COUNTS);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const places = await listPlaces();
        if (!cancelled) setCounts(countPlacesByTrip(places));
      } catch (err: unknown) {
        if (cancelled) return;
        logger.warn("Failed to load the places for the trip list", err);
        setCounts(NO_COUNTS);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  return { counts, failed, reload };
}

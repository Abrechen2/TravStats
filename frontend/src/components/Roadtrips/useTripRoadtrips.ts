import { useEffect, useState } from "react";

import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import type { TourRoute } from "../../types/tour";

/**
 * The roadtrips a trip holds, for the trip's overview. Empty while loading,
 * when the domain is off, and when the call fails — the overview lists what
 * it has and says nothing about what it could not ask, the same way it
 * treats every other linked entry.
 */
export function useTripRoadtrips(tripId: string, enabled: boolean): TourRoute[] {
  const [rows, setRows] = useState<TourRoute[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let cancelled = false;
    toursApi
      .list(tripId)
      .then((routes) => !cancelled && setRows(routes.filter((r) => r.kind === "roadtrip")))
      .catch((err: unknown) => logger.warn("Loading a trip's roadtrips failed", err));
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);
  return rows;
}

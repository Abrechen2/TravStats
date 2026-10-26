import { useEffect, useState } from "react";
import { travTrackApi, type SharedTripRoute } from "../lib/api/travtrack";
import { logger } from "../lib/logger";

export interface SharedTripRoutesState {
  /** Empty while nobody shares a route — and until the first answer. */
  routes: SharedTripRoute[];
  /** The routes could not be read: the map says so instead of looking unshared. */
  failed: boolean;
}

/**
 * The routes the other members of a shared trip share with the reader
 * (TravTrack plan T7), for the trip map. Asked only where TravTrack is on
 * (`enabled`); nobody sharing one is an empty list, a failed read its own state.
 */
export function useSharedTripRoutes(tripId: string, enabled: boolean): SharedTripRoutesState {
  const [state, setState] = useState<SharedTripRoutesState>({ routes: [], failed: false });

  useEffect(() => {
    setState({ routes: [], failed: false });
    if (!enabled) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const routes = await travTrackApi.sharedRoutes(tripId);
        if (!cancelled) setState({ routes, failed: false });
      } catch (err: unknown) {
        if (cancelled) return;
        logger.warn("useSharedTripRoutes: failed to load the shared routes", err);
        setState({ routes: [], failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);

  return state;
}

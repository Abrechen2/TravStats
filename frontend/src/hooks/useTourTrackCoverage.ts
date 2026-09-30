import { useEffect, useState } from "react";

import { toursApi } from "../lib/api/tours";
import { logger } from "../lib/logger";

export interface TourTrackCoverage {
  /** legId → the recording the server says covers it. Only covered legs. */
  coveringTrackByLegId: ReadonlyMap<string, string>;
  /**
   * True once the server has answered for the CURRENT legs and recordings.
   * An absent map entry is only a real "no recording covers this leg" while
   * this is true; while loading, or after a failed request, it means "not
   * known", and the leg list must not say "no track covers this".
   */
  known: boolean;
}

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * The tour editor's leg ↔ recording coverage, asked of the server
 * (`GET …/legs/track-coverage`). Replaces the browser-side check that fetched
 * every track's geometry and carried its own copy of the anchor tolerance.
 *
 * `refreshKey` names what the answer depends on — the legs and the recordings
 * — so a changed itinerary or a new upload asks again.
 */
export function useTourTrackCoverage(
  tripId: string | undefined,
  routeId: string | undefined,
  refreshKey: string
): TourTrackCoverage {
  const [state, setState] = useState<{ key: string; map: ReadonlyMap<string, string> } | null>(
    null
  );

  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const coverage = await toursApi.tracks.coverage(tripId, routeId);
        const map = new Map<string, string>();
        for (const leg of coverage) {
          if (leg.verdict && leg.verdict.status !== "notCovered" && leg.verdict.trackId) {
            map.set(leg.legId, leg.verdict.trackId);
          }
        }
        if (!cancelled) setState({ key: refreshKey, map });
      } catch (err) {
        // Stays unknown rather than empty: an empty map would tell the leg
        // list "no recording covers any leg", which a failed request is not.
        logger.warn("useTourTrackCoverage: coverage request failed", err);
        if (!cancelled) setState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, routeId, refreshKey]);

  const current = state !== null && state.key === refreshKey;
  return { coveringTrackByLegId: current ? state.map : EMPTY, known: current };
}
